import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { createApp, type App } from '../server/app.ts'
import { findMainClasses, parseJavacOutput } from '../server/java-source.ts'
import { findJdk } from '../server/jdk.ts'
import {
  COLLAB_PATH,
  IMAGE_API,
  K_CONSOLE,
  K_DIAGNOSTICS,
  K_FILES,
  K_POSTED,
  K_PROBLEMS,
  K_RUN,
  K_TUTEES,
  MAX_IMAGE_BYTES,
  PROBLEM_DOC,
  ROSTER_DOC,
  problemImageUrl,
  tuteeDocName,
  type ConsoleEntry,
  type JavaDiagnostic,
  type ProblemEntry,
  type RunCommand,
} from '../shared/protocol.ts'

const PORT = 3900 + Math.floor(Math.random() * 90)
const BASE = `http://127.0.0.1:${PORT}`
const TUTOR = JSON.stringify({ role: 'tutor', code: '4321' })

let app: App
let dataDir: string
const sockets: HocuspocusProviderWebsocket[] = []

function connect(name: string, token: string) {
  const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${PORT}${COLLAB_PATH}` })
  sockets.push(socket)
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, token })
  provider.attach()
  return provider
}

function synced(p: HocuspocusProvider) {
  return new Promise<void>((resolve, reject) => {
    if (p.isSynced) return resolve()
    p.on('synced', () => resolve())
    p.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)))
  })
}

async function until(cond: () => boolean, ms = 15000, label = 'condition') {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

const consoleText = (doc: Y.Doc) =>
  doc
    .getArray<ConsoleEntry>(K_CONSOLE)
    .toArray()
    .map((e) => e.s)
    .join('')
const runState = (doc: Y.Doc) => doc.getMap(K_RUN).get('state')
const send = (p: HocuspocusProvider, cmd: RunCommand) => p.sendStateless(JSON.stringify(cmd))

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const upload = (body: Buffer | string, code?: string) =>
  fetch(`${BASE}${IMAGE_API}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : new Uint8Array(body),
    headers: code ? { 'X-Tutor-Code': code } : {},
  })

async function join(name: string) {
  const res = await fetch(`${BASE}/api/join`, { method: 'POST', body: JSON.stringify({ name }) })
  assert.equal(res.status, 200)
  return (await res.json()) as { id: string; name: string; secret: string }
}

function setFile(doc: Y.Doc, name: string, content: string) {
  const files = doc.getMap<Y.Text>(K_FILES)
  doc.transact(() => {
    const t = files.get(name)
    if (t) {
      t.delete(0, t.length)
      t.insert(0, content)
    } else files.set(name, new Y.Text(content))
  })
}

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'oop-tutoring-test-'))
  app = createApp({
    port: PORT,
    host: '127.0.0.1',
    dataDir,
    webRoot: path.join(dataDir, 'web'),
    tutorCode: '4321',
    jdk: findJdk(),
    runner: { runTimeoutMs: 20_000 },
  })
  await app.listen()
})

after(async () => {
  for (const s of sockets) s.destroy()
  await app.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('java source helpers', () => {
  test('finds main classes with OOP code where another class comes first', () => {
    const src = `
      // class Fake { public static void main(String[] a) {} }
      class Animal { String sound() { return "}"; } }
      public class Hello {
        static class Inner { public static void main(String... args) {} }
        public static void main(String[] args) { System.out.println("class X {"); }
      }`
    assert.deepEqual(findMainClasses(src).sort(), ['Hello', 'Hello$Inner'])
  })

  test('parses javac diagnostics with column and details', () => {
    const out = [
      'Main.java:3: error: cannot find symbol',
      '        int x = y;',
      '                ^',
      '  symbol:   variable y',
      '  location: class Main',
      'Dog.java:1: error: class Doggo is public, should be declared in a file named Doggo.java',
      'public class Doggo {',
      '       ^',
      '2 errors',
    ].join('\n')
    const d = parseJavacOutput(out)
    assert.equal(d.length, 2)
    assert.deepEqual(
      { file: d[0].file, line: d[0].line, col: d[0].col },
      { file: 'Main.java', line: 3, col: 17 },
    )
    assert.match(d[0].message, /symbol: {3}variable y/)
    assert.equal(d[1].file, 'Dog.java')
    assert.equal(d[1].col, 8)
  })
})

describe('server', () => {
  test('rejects bad credentials and wrong documents', async () => {
    const bad = await fetch(`${BASE}/api/tutor`, { method: 'POST', body: JSON.stringify({ code: 'nope' }) })
    assert.equal(bad.status, 401)
    const a = await join('권한테스트')
    const other = await join('다른튜티')
    const p = connect(tuteeDocName(other.id), JSON.stringify({ role: 'tutee', id: a.id, secret: a.secret }))
    await assert.rejects(synced(p))
    p.destroy()
    const r = connect(ROSTER_DOC, JSON.stringify({ role: 'tutee', id: a.id, secret: a.secret }))
    await assert.rejects(synced(r))
    r.destroy()
  })

  test('tutee and tutor edit the same workspace in real time; rejoin keeps identity', async () => {
    const me = await join('김자바')
    const again = await join('김자바')
    assert.equal(again.id, me.id)

    const tutee = connect(tuteeDocName(me.id), JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    const tutor = connect(tuteeDocName(me.id), TUTOR)
    const roster = connect(ROSTER_DOC, TUTOR)
    await Promise.all([synced(tutee), synced(tutor), synced(roster)])

    assert.equal(roster.document.getMap<{ name: string }>(K_TUTEES).get(me.id)?.name, '김자바')
    const tFiles = tutee.document.getMap<Y.Text>(K_FILES)
    assert.ok(tFiles.get('Main.java'), 'new workspace starts with Main.java')

    // tutee creates a class file, tutor types into it
    setFile(tutee.document, 'Dog.java', 'public class Dog {\n}\n')
    await until(() => !!tutor.document.getMap<Y.Text>(K_FILES).get('Dog.java'), 5000, 'file sync')
    tutor.document.getMap<Y.Text>(K_FILES).get('Dog.java')!.insert(18, '    // 튜터 피드백\n')
    await until(() => tFiles.get('Dog.java')!.toString().includes('튜터 피드백'), 5000, 'tutor edit sync')
    tutee.destroy()
    tutor.destroy()
    roster.destroy()
  })

  test('compiles multiple files, runs interactively with Scanner (Korean), shares console', async () => {
    const me = await join('이객체')
    const tutee = connect(tuteeDocName(me.id), JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    const tutor = connect(tuteeDocName(me.id), TUTOR)
    await Promise.all([synced(tutee), synced(tutor)])
    const doc = tutee.document

    setFile(doc, 'Animal.java', 'public class Animal {\n    String sound() { return "..."; }\n}\n')
    setFile(doc, 'Dog.java', 'public class Dog extends Animal {\n    @Override String sound() { return "멍멍"; }\n}\n')
    setFile(
      doc,
      'Main.java',
      `import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("이름: ");
        String name = sc.nextLine();
        System.out.print("나이: ");
        int age = sc.nextInt();
        Animal a = new Dog();
        System.out.println(name + "(" + age + ") " + a.sound());
    }
}
`,
    )
    await until(() => tutor.document.getMap<Y.Text>(K_FILES).size === 3, 5000, 'files synced')

    send(tutee, { type: 'run', file: 'Main.java' })
    await until(() => consoleText(doc).includes('이름: '), 15000, 'prompt without newline')
    assert.equal(runState(doc), 'running')
    send(tutee, { type: 'stdin', line: '홍길동' })
    await until(() => consoleText(doc).includes('나이: '), 5000, 'second prompt')
    send(tutor, { type: 'stdin', line: '20' }) // tutor can answer too
    await until(() => runState(doc) === 'exited', 10000, 'exit')
    const text = consoleText(doc)
    assert.match(text, /홍길동\(20\) 멍멍/)
    assert.equal(doc.getMap(K_RUN).get('exitCode'), 0)
    // tutor sees the same console
    await until(() => consoleText(tutor.document) === text, 5000, 'console shared')
    const kinds = doc.getArray<ConsoleEntry>(K_CONSOLE).toArray().filter((e) => e.t === 'in').map((e) => e.s)
    assert.deepEqual(kinds, ['홍길동\n', '20\n'])
    tutee.destroy()
    tutor.destroy()
  })

  test('reports compile errors as diagnostics and enforces Java 17', async () => {
    const me = await join('박에러')
    const tutee = connect(tuteeDocName(me.id), JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    await synced(tutee)
    const doc = tutee.document
    setFile(
      doc,
      'Main.java',
      `public class Main {
    public static void main(String[] args) {
        Object o = "hi";
        String r = switch (o) { case String s -> s; default -> "x"; };
    }
}
`,
    )
    send(tutee, { type: 'run' })
    await until(() => runState(doc) === 'compile-error', 15000, 'compile error')
    const diags = doc.getArray<JavaDiagnostic>(K_DIAGNOSTICS).toArray()
    assert.ok(diags.some((d) => d.line === 4 && /not supported in -source 17/.test(d.message)), JSON.stringify(diags))

    // semantic errors carry the caret column
    setFile(doc, 'Main.java', 'public class Main {\n    public static void main(String[] args) {\n        int x = y;\n    }\n}\n')
    send(tutee, { type: 'run' })
    await until(
      () => doc.getArray<JavaDiagnostic>(K_DIAGNOSTICS).toArray().some((d) => /cannot find symbol/.test(d.message)),
      15000,
      'symbol error',
    )
    const d = doc.getArray<JavaDiagnostic>(K_DIAGNOSTICS).get(0)
    assert.deepEqual([d.file, d.line, d.col], ['Main.java', 3, 17])
    tutee.destroy()
  })

  test('stop kills an infinite loop', async () => {
    const me = await join('최무한')
    const tutee = connect(tuteeDocName(me.id), JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    await synced(tutee)
    const doc = tutee.document
    setFile(
      doc,
      'Main.java',
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("start");\n        while (true) {}\n    }\n}\n',
    )
    send(tutee, { type: 'run' })
    await until(() => consoleText(doc).includes('start'), 15000, 'program started')
    send(tutee, { type: 'stop' })
    await until(() => runState(doc) === 'stopped', 5000, 'stopped')
    assert.match(consoleText(doc), /중지됨/)
    tutee.destroy()
  })

  test('tutor posts problem images; tutees see them read-only', async () => {
    assert.equal((await upload(PNG)).status, 401)
    assert.equal((await upload(PNG, 'nope')).status, 401)
    assert.equal((await upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '4321')).status, 415)
    assert.equal((await upload(Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]), '4321')).status, 413)

    const res = await upload(PNG, '4321')
    assert.equal(res.status, 200)
    const { file } = (await res.json()) as { file: string }
    const img = await fetch(`${BASE}${problemImageUrl(file)}`)
    assert.equal(img.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG)
    assert.equal((await fetch(`${BASE}${IMAGE_API}/..%2Froster.json`)).status, 404)

    const tutor = connect(PROBLEM_DOC, TUTOR)
    const me = await join('문제보기')
    const tutee = connect(PROBLEM_DOC, JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    await Promise.all([synced(tutor), synced(tutee)])
    tutor.document.transact(() => {
      tutor.document.getMap<ProblemEntry>(K_PROBLEMS).set('p1', { title: '문제 1', images: [file], createdAt: Date.now() })
      tutor.document.getMap(K_POSTED).set('id', 'p1')
    })
    await until(() => tutee.document.getMap(K_POSTED).get('id') === 'p1', 5000, 'posted problem sync')
    assert.deepEqual(tutee.document.getMap<ProblemEntry>(K_PROBLEMS).get('p1')?.images, [file])

    // a tutee's edits to the problem doc are dropped by the server
    tutee.document.getMap(K_POSTED).set('id', 'hacked')
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(tutor.document.getMap(K_POSTED).get('id'), 'p1')

    const del = await fetch(`${BASE}${problemImageUrl(file)}`, { method: 'DELETE' })
    assert.equal(del.status, 401)
    tutor.destroy()
    tutee.destroy()
  })

  test('workspace survives a server restart', async () => {
    const me = await join('정저장')
    const tutee = connect(tuteeDocName(me.id), JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    await synced(tutee)
    setFile(tutee.document, 'Cat.java', 'public class Cat {}\n')
    await until(() => tutee.unsyncedChanges === 0, 5000, 'flushed to server')
    tutee.destroy()
    await app.close()

    app = createApp({
      port: PORT,
      host: '127.0.0.1',
      dataDir,
      webRoot: path.join(dataDir, 'web'),
      tutorCode: '4321',
      jdk: findJdk(),
    })
    await app.listen()
    const back = connect(tuteeDocName(me.id), JSON.stringify({ role: 'tutee', id: me.id, secret: me.secret }))
    await synced(back)
    assert.equal(back.document.getMap<Y.Text>(K_FILES).get('Cat.java')?.toString(), 'public class Cat {}\n')
    back.destroy()

    const problem = connect(PROBLEM_DOC, TUTOR)
    await synced(problem)
    assert.equal(problem.document.getMap(K_POSTED).get('id'), 'p1', 'posted problem survives restart')
    const file = problem.document.getMap<ProblemEntry>(K_PROBLEMS).get('p1')!.images[0]
    assert.equal((await fetch(`${BASE}${problemImageUrl(file)}`)).status, 200)
    const del = await fetch(`${BASE}${problemImageUrl(file)}`, { method: 'DELETE', headers: { 'X-Tutor-Code': '4321' } })
    assert.equal(del.status, 200)
    assert.equal((await fetch(`${BASE}${problemImageUrl(file)}`)).status, 404)
    problem.destroy()
  })
})
