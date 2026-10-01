import type { JavaDiagnostic } from '../shared/protocol.ts'

/** Replace comments, string, text-block and char literals with spaces (keeps offsets and newlines). */
export function stripJava(src: string): string {
  let out = ''
  let i = 0
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      out += blank(src.slice(i, stop))
      i = stop
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += blank(src.slice(i, stop))
      i = stop
    } else if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3)
      const stop = end === -1 ? src.length : end + 3
      out += blank(src.slice(i, stop))
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      const stop = Math.min(j + 1, src.length)
      out += blank(src.slice(i, stop))
      i = stop
    } else {
      out += c
      i++
    }
  }
  return out
}

const TOKEN =
  /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)|[{};]|\bvoid\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)/g

/**
 * Binary names of classes declaring `public static void main(String[])`,
 * e.g. ["Main", "Outer$Inner"]. Heuristic, good enough for tutoring code.
 */
export function findMainClasses(source: string): string[] {
  const src = stripJava(source)
  const stack: Array<string | null> = [] // class name for class bodies, null for other blocks
  let pendingClass: string | null = null
  let declStart = 0 // start of the current declaration (after the last ; { })
  const result: string[] = []
  for (const m of src.matchAll(TOKEN)) {
    const tok = m[0]
    if (m[1]) {
      pendingClass = m[1]
    } else if (tok === '{') {
      stack.push(pendingClass)
      pendingClass = null
      declStart = m.index + 1
    } else if (tok === '}') {
      stack.pop()
      pendingClass = null
      declStart = m.index + 1
    } else if (tok === ';') {
      declStart = m.index + 1
    } else {
      const modifiers = src.slice(declStart, m.index)
      const inClassBody = stack.length > 0 && stack.every((s) => s !== null)
      if (inClassBody && /\bstatic\b/.test(modifiers) && /\bpublic\b/.test(modifiers)) {
        result.push((stack as string[]).join('$'))
      }
    }
  }
  return [...new Set(result)]
}

/** Parse `javac` output (English locale) into diagnostics. */
export function parseJavacOutput(output: string): JavaDiagnostic[] {
  const lines = output.split(/\r?\n/)
  const diags: JavaDiagnostic[] = []
  const head = /^(?:.*[\\/])?([^\\/]+\.java):(\d+): (error|warning): (.*)$/
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i])
    if (!m) continue
    const message = [m[4]]
    let col = 1
    // Following lines: source line, caret line, then optional detail lines ("  symbol: ...")
    for (let j = i + 1; j < lines.length && !head.test(lines[j]); j++) {
      const caret = lines[j].indexOf('^')
      if (caret !== -1 && /^\s*\^\s*$/.test(lines[j])) {
        col = caret + 1
        for (let k = j + 1; k < lines.length && /^\s{2,}\S/.test(lines[k]) && !head.test(lines[k]); k++) {
          message.push(lines[k].trim())
        }
        break
      }
    }
    diags.push({
      file: m[1],
      line: parseInt(m[2], 10),
      col,
      severity: m[3] as 'error' | 'warning',
      message: message.join('\n'),
    })
  }
  return diags
}
