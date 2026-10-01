import type { IncomingMessage, ServerResponse } from 'node:http'
import { Server, type Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  COLLAB_PATH,
  K_FILES,
  K_RUN,
  K_TUTEES,
  MAIN_TEMPLATE,
  ROSTER_DOC,
  TUTEE_DOC_PREFIX,
  tuteeDocName,
  type AuthToken,
  type RosterCommand,
  type RosterEntry,
  type RunCommand,
} from '../shared/protocol.ts'
import type { Jdk } from './jdk.ts'
import { JavaRunner, type RunnerOptions } from './runner.ts'
import { serveStatic } from './static.ts'
import { DocStore, Roster } from './store.ts'

export type ConnContext = { role: 'tutor' } | { role: 'tutee'; id: string; name: string } | { role: 'system' }

export interface AppOptions {
  port: number
  host: string
  dataDir: string
  webRoot: string
  tutorCode: string
  jdk: Jdk
  runner?: Partial<RunnerOptions>
}

export interface App {
  server: Server<ConnContext>
  hocuspocus: Hocuspocus<ConnContext>
  runner: JavaRunner
  roster: Roster
  listen(): Promise<void>
  close(): Promise<void>
}

const MAX_NAME = 20

export function createApp(opts: AppOptions): App {
  const store = new DocStore(opts.dataDir)
  const roster = new Roster(opts.dataDir)

  const server: Server<ConnContext> = new Server<ConnContext>({
    port: opts.port,
    address: opts.host,
    quiet: true,
    stopOnSignals: false,
    debounce: 1000,
    maxDebounce: 5000,

    async onUpgrade({ request, socket }) {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== COLLAB_PATH) {
        socket.destroy()
        throw null
      }
    },

    async onAuthenticate({ token, documentName, connectionConfig }): Promise<ConnContext> {
      let auth: AuthToken
      try {
        auth = JSON.parse(token)
      } catch {
        throw new Error('invalid token')
      }
      if (auth.role === 'tutor') {
        if (auth.code !== opts.tutorCode) throw new Error('wrong tutor code')
        if (documentName !== ROSTER_DOC && !documentName.startsWith(TUTEE_DOC_PREFIX)) throw new Error('unknown doc')
        return { role: 'tutor' }
      }
      if (auth.role === 'tutee') {
        const rec = roster.get(auth.id)
        if (!rec || rec.secret !== auth.secret) throw new Error('unknown tutee')
        if (documentName !== tuteeDocName(rec.id)) throw new Error('forbidden')
        connectionConfig.readOnly = false
        return { role: 'tutee', id: rec.id, name: rec.name }
      }
      throw new Error('invalid role')
    },

    async onLoadDocument({ document, documentName }) {
      if (documentName === ROSTER_DOC) {
        const tutees = document.getMap<RosterEntry>(K_TUTEES)
        document.transact(() => {
          for (const t of roster.list()) tutees.set(t.id, { name: t.name, joinedAt: t.joinedAt })
        })
        return
      }
      if (!documentName.startsWith(TUTEE_DOC_PREFIX)) return
      const saved = await store.load(documentName)
      if (saved) Y.applyUpdate(document, saved)
      document.transact(() => {
        const files = document.getMap<Y.Text>(K_FILES)
        if (files.size === 0) files.set('Main.java', new Y.Text(MAIN_TEMPLATE))
        // A run that was in progress when the server stopped can't be resumed.
        const run = document.getMap(K_RUN)
        const state = run.get('state')
        if ((state === 'running' || state === 'compiling') && !runner.isRunning(documentName)) {
          run.set('state', 'stopped')
        }
      })
    },

    async onStoreDocument({ document, documentName }) {
      if (!documentName.startsWith(TUTEE_DOC_PREFIX)) return
      await store.save(documentName, Y.encodeStateAsUpdate(document))
    },

    async onStateless({ payload, documentName, connection }) {
      const ctx = connection.context as ConnContext
      if (ctx.role === 'system') return
      let cmd: RunCommand | RosterCommand
      try {
        cmd = JSON.parse(payload)
      } catch {
        return
      }
      if (documentName === ROSTER_DOC) {
        if (ctx.role === 'tutor' && cmd.type === 'removeTutee') await removeTutee(cmd.id)
        return
      }
      if (!documentName.startsWith(TUTEE_DOC_PREFIX)) return
      switch (cmd.type) {
        case 'run':
          void runner.run(documentName, cmd.file, ctx.role)
          break
        case 'stdin':
          runner.stdin(documentName, String(cmd.line ?? ''))
          break
        case 'stop':
          await runner.stop(documentName)
          break
      }
    },

    async onRequest({ request, response }) {
      await handleHttp(request, response)
      throw null // response handled; skip Hocuspocus' default responder
    },
  })

  const hocuspocus = server.hocuspocus
  const runner = new JavaRunner(hocuspocus, opts.jdk, opts.runner)

  async function updateRosterDoc(fn: (tutees: Y.Map<RosterEntry>) => void) {
    const conn = await hocuspocus.openDirectConnection(ROSTER_DOC, { role: 'system' })
    await conn.transact((doc) => fn(doc.getMap<RosterEntry>(K_TUTEES)))
    await conn.disconnect()
  }

  async function removeTutee(id: string) {
    await roster.remove(id)
    await runner.stop(tuteeDocName(id))
    await updateRosterDoc((t) => t.delete(id))
    hocuspocus.closeConnections(tuteeDocName(id))
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/api/join' && req.method === 'POST') {
        const body = await readJson(req)
        const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ')
        if (!name || name.length > MAX_NAME) return sendJson(res, 400, { error: `이름은 1~${MAX_NAME}자로 입력하세요.` })
        const { record } = await roster.join(name)
        await updateRosterDoc((t) => t.set(record.id, { name: record.name, joinedAt: record.joinedAt }))
        return sendJson(res, 200, { id: record.id, name: record.name, secret: record.secret })
      }
      if (url.pathname === '/api/tutor' && req.method === 'POST') {
        const body = await readJson(req)
        return body?.code === opts.tutorCode
          ? sendJson(res, 200, { ok: true })
          : sendJson(res, 401, { error: '튜터 코드가 올바르지 않습니다.' })
      }
      if (url.pathname === '/api/info') {
        return sendJson(res, 200, { java: opts.jdk.version, release: 17 })
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
      await serveStatic(opts.webRoot, req, res)
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message })
    }
  }

  return {
    server,
    hocuspocus,
    runner,
    roster,
    async listen() {
      await server.listen()
    },
    async close() {
      await runner.stopAll()
      await server.destroy()
    },
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 10_000) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}
