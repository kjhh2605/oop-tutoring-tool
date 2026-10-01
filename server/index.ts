import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { findJdk } from './jdk.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'))
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
const webPort = process.env.WEB_PORT // set by `npm run dev` (Vite dev server)

mkdirSync(dataDir, { recursive: true })

/** The tutor code is generated once and kept in data/config.json so it survives restarts. */
function loadTutorCode() {
  if (process.env.TUTOR_CODE) return process.env.TUTOR_CODE
  const file = path.join(dataDir, 'config.json')
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  if (!config.tutorCode) {
    config.tutorCode = String(randomInt(1000, 10000))
    writeFileSync(file, JSON.stringify(config, null, 2))
  }
  return config.tutorCode as string
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
}

const jdk = findJdk()
const tutorCode = loadTutorCode()
const app = createApp({
  port,
  host,
  dataDir,
  webRoot: path.join(root, 'web', 'dist'),
  tutorCode,
  jdk,
  runner: process.env.RUN_TIMEOUT_SEC ? { runTimeoutMs: Number(process.env.RUN_TIMEOUT_SEC) * 1000 } : {},
})

await app.listen()

const shownPort = webPort ?? String(port)
const urls = lanAddresses().map((ip) => `http://${ip}:${shownPort}`)
const line = '─'.repeat(56)
console.log(`\n${line}`)
console.log(' Java 튜토링 편집기 실행 중')
console.log(line)
console.log(' 튜티 접속 주소 (같은 Wi-Fi):')
for (const u of urls.length ? urls : [`http://localhost:${shownPort}`]) console.log(`   ${u}`)
console.log(` 튜터 화면:  ${urls[0] ?? `http://localhost:${shownPort}`}/tutor`)
console.log(` 튜터 코드:  ${tutorCode}`)
console.log(
  ` Java:       ${jdk.version} (${jdk.source})` +
    (jdk.major === 17 ? '' : `\n             ⚠ JDK 17이 아니므로 --release 17로 컴파일합니다(런타임은 ${jdk.major}).`),
)
console.log(` 데이터:     ${dataDir}`)
console.log(`${line}\n`)

let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  await app.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
