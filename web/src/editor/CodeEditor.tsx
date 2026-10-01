import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { Awareness } from '../lib/collab.ts'
import { diagnosticsOf, marksOf } from '../lib/workspace.ts'
import { javacDiagnostics } from './diagnostics.ts'
import { javaEditorSetup } from './setup.ts'
import { tutorMarks } from './tutorMarks.ts'

// Each client keeps its own undo history per file (so a tutee's Ctrl+Z never undoes the tutor's typing).
const undoManagers = new WeakMap<Y.Text, Y.UndoManager>()
function undoManagerFor(ytext: Y.Text) {
  let um = undoManagers.get(ytext)
  if (!um) {
    um = new Y.UndoManager(ytext)
    undoManagers.set(ytext, um)
  }
  return um
}

interface Props {
  ytext: Y.Text
  fileName: string
  awareness: Awareness | null
  readOnly?: boolean
  recordTutorMarks?: boolean
  autoFocus?: boolean
  onView?: (view: EditorView | null) => void
}

export function CodeEditor({ ytext, fileName, awareness, readOnly = false, recordTutorMarks = false, autoFocus, onView }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const onViewRef = useRef(onView)
  onViewRef.current = onView

  useEffect(() => {
    const doc = ytext.doc!
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          javaEditorSetup({ readOnly }),
          yCollab(ytext, awareness, { undoManager: readOnly ? false : undoManagerFor(ytext) }),
          tutorMarks(ytext, marksOf(doc), fileName, recordTutorMarks && !readOnly),
          javacDiagnostics(diagnosticsOf(doc), fileName),
        ],
      }),
    })
    if (autoFocus) view.focus()
    onViewRef.current?.(view)
    return () => {
      onViewRef.current?.(null)
      view.destroy()
      // Don't leave a stale caret on other screens after switching files or leaving the workspace.
      const cursor = awareness?.getLocalState()?.cursor
      if (!readOnly && cursor) {
        const pos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.head), doc)
        if (!pos || pos.type === ytext) awareness!.setLocalStateField('cursor', null)
      }
    }
  }, [ytext, fileName, awareness, readOnly, recordTutorMarks, autoFocus])

  return <div className="editor-host" ref={host} />
}
