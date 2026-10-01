import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface Jdk {
  javac: string
  java: string
  version: string // e.g. "17.0.12"
  major: number
  source: string // how it was found
}

function probe(home: string | null, source: string): Jdk | null {
  const javac = home ? path.join(home, 'bin', 'javac') : 'javac'
  const java = home ? path.join(home, 'bin', 'java') : 'java'
  if (home && !existsSync(javac)) return null
  try {
    // `javac -version` prints "javac 17.0.12" (to stdout on modern JDKs)
    const out = execFileSync(javac, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const version = out.trim().replace(/^javac\s+/, '')
    const major = parseInt(version.split('.')[0], 10)
    return { javac, java, version, major, source }
  } catch {
    return null
  }
}

function macJavaHome(version: string): string | null {
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('/usr/libexec/java_home', ['-v', version], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Prefer a real JDK 17. Compilation always uses `--release 17`, so a newer JDK
 * still enforces the Java 17 language level and API.
 */
export function findJdk(): Jdk {
  const candidates: Array<[string | null, string]> = []
  if (process.env.JAVA17_HOME) candidates.push([process.env.JAVA17_HOME, 'JAVA17_HOME'])
  // java_home -v 17 silently falls back to another JDK when 17 is missing, so the major version is re-checked below.
  candidates.push([macJavaHome('17'), 'java_home'])
  if (process.env.JAVA_HOME) candidates.push([process.env.JAVA_HOME, 'JAVA_HOME'])
  candidates.push([null, 'PATH'])

  const found: Jdk[] = []
  for (const [home, source] of candidates) {
    if (home === null && source !== 'PATH') continue
    const jdk = probe(home, source)
    if (jdk) found.push(jdk)
  }
  const exact = found.find((j) => j.major === 17)
  if (exact) return exact
  const newer = found.find((j) => j.major > 17)
  if (newer) return newer
  throw new Error('JDK 17 이상을 찾을 수 없습니다. JDK 17을 설치하거나 JAVA17_HOME을 지정하세요.')
}
