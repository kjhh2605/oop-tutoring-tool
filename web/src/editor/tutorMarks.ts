import { type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { ySyncAnnotation } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { TutorMark } from '../../../shared/protocol.ts'

const markDeco = Decoration.mark({ class: 'cm-tutor-mark', attributes: { title: '튜터가 입력한 부분' } })

function absolute(rel: unknown, doc: Y.Doc, ytext: Y.Text) {
  const pos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), doc)
  return pos && pos.type === ytext ? pos.index : null
}

/**
 * Highlights text typed by the tutor. When `record` is true (tutor's editor), local insertions are
 * stored as Yjs relative positions so the highlight follows later edits on every client.
 */
export function tutorMarks(ytext: Y.Text, marks: Y.Map<Y.Array<TutorMark>>, fileName: string, record: boolean): Extension {
  const doc = ytext.doc!

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private destroyed = false
      private scheduled = false
      private readonly onMarksChange = () => {
        if (this.scheduled) return
        this.scheduled = true
        queueMicrotask(() => {
          this.scheduled = false
          if (!this.destroyed) this.view.dispatch({}) // re-run update() to rebuild decorations
        })
      }

      constructor(private readonly view: EditorView) {
        this.decorations = this.build()
        marks.observeDeep(this.onMarksChange)
      }

      update(update: ViewUpdate) {
        if (record && update.docChanged) this.recordLocalInsertions(update)
        this.decorations = this.build()
      }

      destroy() {
        this.destroyed = true
        marks.unobserveDeep(this.onMarksChange)
      }

      private build(): DecorationSet {
        const arr = marks.get(fileName)
        if (!arr) return Decoration.none
        const len = this.view.state.doc.length
        const ranges: Range<Decoration>[] = []
        for (const m of arr.toArray()) {
          const a = absolute(m.a, doc, ytext)
          const b = absolute(m.b, doc, ytext)
          if (a === null || b === null || b <= a || b > len) continue
          ranges.push(markDeco.range(a, b))
        }
        return Decoration.set(ranges, true)
      }

      private recordLocalInsertions(update: ViewUpdate) {
        const ranges: Array<[number, number]> = []
        update.transactions.forEach((tr, i) => {
          if (tr.annotation(ySyncAnnotation)) return // remote change
          if (!tr.isUserEvent('input') && !tr.isUserEvent('paste') && !tr.isUserEvent('move.drop')) return
          tr.changes.iterChanges((_fa, _ta, fromB, toB) => {
            if (toB <= fromB) return
            let from = fromB
            let to = toB
            for (const later of update.transactions.slice(i + 1)) {
              from = later.changes.mapPos(from, 1)
              to = later.changes.mapPos(to, -1)
            }
            if (to > from) ranges.push([from, to])
          })
        })
        if (ranges.length === 0) return
        // y-codemirror applies the edit to the Y.Text during this same update cycle; record right after it.
        queueMicrotask(() => {
          if (ytext.length !== this.view.state.doc.length) return
          doc.transact(() => {
            let arr = marks.get(fileName)
            if (!arr) {
              arr = new Y.Array<TutorMark>()
              marks.set(fileName, arr)
            }
            for (const [from, to] of ranges) appendMark(arr, ytext, doc, from, to)
          })
        })
      }
    },
    { decorations: (v) => v.decorations },
  )
  return plugin
}

function appendMark(arr: Y.Array<TutorMark>, ytext: Y.Text, doc: Y.Doc, from: number, to: number) {
  const end = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1))
  const last = arr.length > 0 ? arr.get(arr.length - 1) : null
  if (last) {
    const lastStart = absolute(last.a, doc, ytext)
    const lastEnd = absolute(last.b, doc, ytext)
    // Typing continues right after (or inside) the previous mark: extend it instead of adding many tiny ones.
    if (lastStart !== null && lastEnd !== null && from >= lastStart && from <= lastEnd) {
      arr.delete(arr.length - 1, 1)
      arr.push([{ a: last.a, b: to > lastEnd ? end : last.b }])
      return
    }
  }
  arr.push([{ a: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0)), b: end }])
}
