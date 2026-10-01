import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { Text } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type * as Y from 'yjs'
import type { JavaDiagnostic } from '../../../shared/protocol.ts'

function toCm(d: JavaDiagnostic, doc: Text): Diagnostic {
  const lineNo = Math.min(Math.max(d.line, 1), doc.lines)
  const line = doc.line(lineNo)
  let from = Math.min(line.from + Math.max(d.col - 1, 0), line.to)
  // underline the token at the caret (or one char)
  const rest = doc.sliceString(from, line.to)
  const word = /^[\w$]+/.exec(rest)?.[0].length ?? 1
  let to = Math.min(from + word, line.to)
  // Errors at the end of a line (e.g. "';' expected") would be zero-width: mark the previous character instead.
  if (to === from && from > line.from) from -= 1
  if (to === from && to < line.to) to += 1
  return {
    from,
    to,
    severity: d.severity,
    message: d.message,
    source: 'javac',
  }
}

/** Shows the server's javac diagnostics for `fileName` as lint markers. */
export function javacDiagnostics(diagnostics: Y.Array<JavaDiagnostic>, fileName: string) {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false
      private readonly sync = () =>
        queueMicrotask(() => {
          if (this.destroyed) return
          const doc = this.view.state.doc
          const list = diagnostics
            .toArray()
            .filter((d) => d.file === fileName)
            .map((d) => toCm(d, doc))
          this.view.dispatch(setDiagnostics(this.view.state, list))
        })

      constructor(private readonly view: EditorView) {
        diagnostics.observe(this.sync)
        this.sync()
      }

      destroy() {
        this.destroyed = true
        diagnostics.unobserve(this.sync)
      }
    },
  )
}
