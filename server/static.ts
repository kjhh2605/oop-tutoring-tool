import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

/** Serves the built web app; unknown paths without an extension fall back to index.html (SPA routes). */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  let file = path.join(root, path.normalize(rel))
  if (!file.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  let info = await stat(file).catch(() => null)
  if (!info?.isFile() && !path.extname(rel)) {
    file = path.join(root, 'index.html')
    info = await stat(file).catch(() => null)
  }
  if (!info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
      file.endsWith('index.html') ? '웹 앱이 빌드되지 않았습니다. `npm start`로 실행하세요.' : 'Not found',
    )
    return
  }
  const isAsset = rel.startsWith('/assets/')
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}
