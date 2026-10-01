import * as Y from 'yjs'
import {
  K_CONSOLE,
  K_DIAGNOSTICS,
  K_FILES,
  K_MARKS,
  K_RUN,
  classTemplate,
  validateClassName,
  type ConsoleEntry,
  type JavaDiagnostic,
  type TutorMark,
} from '../../../shared/protocol.ts'

export const filesOf = (doc: Y.Doc) => doc.getMap<Y.Text>(K_FILES)
export const runOf = (doc: Y.Doc) => doc.getMap<any>(K_RUN)
export const consoleOf = (doc: Y.Doc) => doc.getArray<ConsoleEntry>(K_CONSOLE)
export const diagnosticsOf = (doc: Y.Doc) => doc.getArray<JavaDiagnostic>(K_DIAGNOSTICS)
export const marksOf = (doc: Y.Doc) => doc.getMap<Y.Array<TutorMark>>(K_MARKS)

/** File names in tab order: Main.java first, then alphabetical. */
export function listFiles(doc: Y.Doc): string[] {
  return [...filesOf(doc).keys()].sort((a, b) => {
    if (a === 'Main.java') return -1
    if (b === 'Main.java') return 1
    return a.localeCompare(b)
  })
}

export function createClassFile(doc: Y.Doc, className: string): string | null {
  const error = validateClassName(className)
  if (error) return error
  const files = filesOf(doc)
  const name = `${className}.java`
  if (files.has(name)) return `${name} 파일이 이미 있습니다.`
  files.set(name, new Y.Text(classTemplate(className)))
  return null
}

/** Renames a file and the matching `class Old` declaration inside it. */
export function renameClassFile(doc: Y.Doc, from: string, className: string): string | null {
  const error = validateClassName(className)
  if (error) return error
  const files = filesOf(doc)
  const to = `${className}.java`
  if (to === from) return null
  if (files.has(to)) return `${to} 파일이 이미 있습니다.`
  const old = files.get(from)
  if (!old) return '파일을 찾을 수 없습니다.'
  const oldClass = from.replace(/\.java$/, '')
  const content = old.toString().replace(new RegExp(`\\b(class|interface|enum|record)(\\s+)${oldClass}\\b`), `$1$2${className}`)
  doc.transact(() => {
    files.set(to, new Y.Text(content))
    files.delete(from)
    marksOf(doc).delete(from)
  })
  return null
}

export function deleteFile(doc: Y.Doc, name: string) {
  doc.transact(() => {
    filesOf(doc).delete(name)
    marksOf(doc).delete(name)
  })
}

export function clearMarks(doc: Y.Doc) {
  const marks = marksOf(doc)
  doc.transact(() => {
    for (const key of [...marks.keys()]) marks.delete(key)
  })
}

export function hasMarks(doc: Y.Doc) {
  for (const arr of marksOf(doc).values()) if (arr.length > 0) return true
  return false
}
