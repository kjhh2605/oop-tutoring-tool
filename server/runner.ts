import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  K_CONSOLE,
  K_DIAGNOSTICS,
  K_FILES,
  K_RUN,
  isJavaFileName,
  type ConsoleEntry,
  type ConsoleKind,
  type JavaDiagnostic,
  type Role,
  type RunInfo,
} from '../shared/protocol.ts'
import { findMainClasses, parseJavacOutput } from './java-source.ts'
import type { Jdk } from './jdk.ts'

export interface RunnerOptions {
  runTimeoutMs: number
  compileTimeoutMs: number
  maxOutputBytes: number
  maxConsoleEntries: number
}

const DEFAULTS: RunnerOptions = {
  runTimeoutMs: 5 * 60_000,
  compileTimeoutMs: 20_000,
  maxOutputBytes: 200_000,
  maxConsoleEntries: 3000,
}

type DirectConnection = Awaited<ReturnType<Hocuspocus['openDirectConnection']>>

interface Execution {
  proc: ChildProcess | null
  sink: ConsoleSink | null
  stopped: boolean
  done: Promise<void>
}

/** Compiles and runs one tutee workspace at a time per document, streaming I/O into the Y.Doc. */
export class JavaRunner {
  private readonly executions = new Map<string, Execution>()
  private readonly opts: RunnerOptions

  constructor(
    private readonly hocuspocus: Hocuspocus,
    private readonly jdk: Jdk,
    opts: Partial<RunnerOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  isRunning(docName: string) {
    return this.executions.has(docName)
  }

  async run(docName: string, activeFile: string | undefined, by: Role) {
    await this.stop(docName, false)
    let resolveDone!: () => void
    const exec: Execution = { proc: null, sink: null, stopped: false, done: new Promise((r) => (resolveDone = r)) }
    this.executions.set(docName, exec)
    const conn = await this.hocuspocus.openDirectConnection(docName, { role: 'system' })
    const sink = new ConsoleSink(conn, this.opts.maxConsoleEntries)
    exec.sink = sink
    try {
      await this.execute(conn, sink, exec, activeFile, by)
    } catch (err) {
      sink.push('sys', `\n[서버 오류] ${(err as Error).message}\n`)
      await sink.flush()
      await setRun(conn, { state: 'exited', exitCode: null, by })
    } finally {
      await sink.flush()
      await conn.disconnect()
      this.executions.delete(docName)
      resolveDone()
    }
  }

  stdin(docName: string, line: string) {
    const exec = this.executions.get(docName)
    const stdin = exec?.proc?.stdin
    if (!exec || !stdin || stdin.destroyed || !exec.sink) return false
    exec.sink.push('in', line + '\n')
    stdin.write(line + '\n')
    return true
  }

  async stop(docName: string, markStopped = true) {
    const exec = this.executions.get(docName)
    if (!exec) return
    exec.stopped = markStopped
    exec.proc?.kill('SIGKILL')
    await exec.done
  }

  async stopAll() {
    await Promise.all([...this.executions.keys()].map((d) => this.stop(d)))
  }

  private async execute(
    conn: DirectConnection,
    sink: ConsoleSink,
    exec: Execution,
    activeFile: string | undefined,
    by: Role,
  ) {
    const files = readFiles(conn)
    await conn.transact((doc) => {
      doc.transact(() => {
        const consoleArr = doc.getArray<ConsoleEntry>(K_CONSOLE)
        consoleArr.delete(0, consoleArr.length)
        const diags = doc.getArray<JavaDiagnostic>(K_DIAGNOSTICS)
        diags.delete(0, diags.length)
        writeRun(doc, { state: 'compiling', by })
      })
    })

    if (files.size === 0) {
      sink.push('sys', '실행할 .java 파일이 없습니다.\n')
      await setRun(conn, { state: 'compile-error', by })
      return
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'oop-tutoring-'))
    try {
      for (const [name, content] of files) await writeFile(path.join(dir, name), content, 'utf8')

      // 1) compile
      const compile = await runProcess(
        this.jdk.javac,
        [
          '-J-Duser.language=en',
          '-J-Duser.country=US',
          '--release',
          '17',
          '-encoding',
          'UTF-8',
          '-Xmaxerrs',
          '50',
          '-d',
          'out',
          ...files.keys(),
        ],
        { cwd: dir, timeoutMs: this.opts.compileTimeoutMs, exec },
      )
      if (exec.stopped) {
        sink.push('sys', '■ 중지됨\n')
        await setRun(conn, { state: 'stopped', by })
        return
      }
      if (compile.code !== 0) {
        const diagnostics = parseJavacOutput(compile.output)
        sink.push('err', compile.output || '컴파일 실패\n')
        await conn.transact((doc) => {
          doc.transact(() => {
            doc.getArray<JavaDiagnostic>(K_DIAGNOSTICS).push(diagnostics)
            writeRun(doc, { state: 'compile-error', by })
          })
        })
        return
      }

      // 2) choose main class
      const mainClass = chooseMainClass(files, activeFile, sink)
      if (!mainClass) {
        await setRun(conn, { state: 'compile-error', by })
        return
      }

      // 3) run interactively
      await setRun(conn, { state: 'running', mainClass, by })
      const exit = await this.spawnJava(dir, mainClass, sink, exec)
      if (exec.stopped) {
        sink.push('sys', '\n■ 중지됨\n')
        await setRun(conn, { state: 'stopped', mainClass, by })
      } else {
        sink.push('sys', `\n— 종료 (exit code ${exit ?? '?'}) —\n`)
        await setRun(conn, { state: 'exited', exitCode: exit, mainClass, by })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  private spawnJava(dir: string, mainClass: string, sink: ConsoleSink, exec: Execution) {
    return new Promise<number | null>((resolve) => {
      const proc = spawn(
        this.jdk.java,
        [
          '-Xmx256m',
          '-Xss4m',
          '-XX:+UseSerialGC',
          '-XX:TieredStopAtLevel=1',
          '-Dfile.encoding=UTF-8',
          '-Dstdout.encoding=UTF-8',
          '-Dstderr.encoding=UTF-8',
          '-Dsun.stdout.encoding=UTF-8',
          '-Dsun.stderr.encoding=UTF-8',
          '-cp',
          'out',
          mainClass,
        ],
        { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      exec.proc = proc
      let bytes = 0
      let killedFor: string | null = null
      const kill = (reason: string) => {
        if (killedFor) return
        killedFor = reason
        proc.kill('SIGKILL')
      }
      const timer = setTimeout(
        () => kill(`실행 시간 제한(${Math.round(this.opts.runTimeoutMs / 1000)}초)을 넘어 강제 종료했습니다.`),
        this.opts.runTimeoutMs,
      )
      const pipe = (stream: NodeJS.ReadableStream, kind: ConsoleKind) => {
        const decoder = new StringDecoder('utf8')
        stream.on('data', (chunk: Buffer) => {
          if (killedFor) return
          bytes += chunk.length
          if (bytes > this.opts.maxOutputBytes) {
            kill(`출력이 너무 많아(${Math.round(this.opts.maxOutputBytes / 1000)}KB 초과) 강제 종료했습니다. 무한 루프를 확인하세요.`)
            return
          }
          sink.push(kind, decoder.write(chunk))
        })
        stream.on('end', () => {
          const rest = decoder.end()
          if (rest) sink.push(kind, rest)
        })
      }
      pipe(proc.stdout!, 'out')
      pipe(proc.stderr!, 'err')
      proc.stdin!.on('error', () => {}) // EPIPE when the program exits before reading input
      proc.on('error', (err) => {
        sink.push('sys', `[실행 오류] ${err.message}\n`)
      })
      proc.on('close', (code) => {
        clearTimeout(timer)
        exec.proc = null
        if (killedFor) sink.push('sys', `\n${killedFor}\n`)
        resolve(code)
      })
    })
  }
}

function readFiles(conn: DirectConnection) {
  const files = new Map<string, string>()
  const map = conn.document!.getMap<Y.Text>(K_FILES)
  for (const [name, text] of map) {
    if (isJavaFileName(name) && text instanceof Y.Text) files.set(name, text.toString())
  }
  return files
}

function chooseMainClass(files: Map<string, string>, activeFile: string | undefined, sink: ConsoleSink) {
  const perFile = new Map<string, string[]>()
  for (const [name, content] of files) {
    const mains = findMainClasses(content)
    if (mains.length) perFile.set(name, mains)
  }
  const all = [...perFile.values()].flat()
  if (all.length === 0) {
    sink.push('sys', 'main 메서드를 찾을 수 없습니다.\npublic static void main(String[] args) { ... } 를 가진 클래스가 필요합니다.\n')
    return null
  }
  const pickFrom = (activeFile && perFile.get(activeFile)) || all
  const base = activeFile?.replace(/\.java$/, '')
  const chosen = pickFrom.find((c) => c === base) ?? pickFrom.find((c) => c === 'Main') ?? pickFrom[0]
  if (all.length > 1) {
    sink.push('sys', `main이 여러 클래스에 있습니다(${all.join(', ')}). ${chosen}을(를) 실행합니다.\n`)
  }
  return chosen
}

function writeRun(doc: Y.Doc, info: RunInfo) {
  const run = doc.getMap(K_RUN)
  run.clear()
  for (const [k, v] of Object.entries(info)) if (v !== undefined) run.set(k, v)
}

function setRun(conn: DirectConnection, info: RunInfo) {
  return conn.transact((doc) => writeRun(doc, info))
}

interface ProcessResult {
  code: number | null
  output: string
}

function runProcess(
  cmd: string,
  args: string[],
  { cwd, timeoutMs, exec }: { cwd: string; timeoutMs: number; exec: Execution },
) {
  return new Promise<ProcessResult>((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    exec.proc = proc
    let output = ''
    proc.stdout.on('data', (d) => (output += d))
    proc.stderr.on('data', (d) => (output += d))
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs)
    proc.on('error', (err) => (output += err.message))
    proc.on('close', (code) => {
      clearTimeout(timer)
      exec.proc = null
      resolve({ code, output })
    })
  })
}

/** Batches console output into the Y.Doc so fast printing doesn't flood the network. */
class ConsoleSink {
  private pending: ConsoleEntry[] = []
  private timer: NodeJS.Timeout | null = null
  private flushing: Promise<void> = Promise.resolve()

  constructor(
    private readonly conn: DirectConnection,
    private readonly maxEntries: number,
  ) {}

  push(t: ConsoleKind, s: string) {
    if (!s) return
    const last = this.pending[this.pending.length - 1]
    if (last && last.t === t) last.s += s
    else this.pending.push({ t, s })
    this.timer ??= setTimeout(() => void this.flush(), 30)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const batch = this.pending
    this.pending = []
    if (batch.length === 0) return this.flushing
    this.flushing = this.flushing.then(() =>
      this.conn.transact((doc) => {
        const arr = doc.getArray<ConsoleEntry>(K_CONSOLE)
        doc.transact(() => {
          arr.push(batch)
          if (arr.length > this.maxEntries) arr.delete(0, arr.length - this.maxEntries)
        })
      }),
    )
    return this.flushing
  }
}
