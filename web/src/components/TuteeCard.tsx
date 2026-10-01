import type { HocuspocusProvider } from '@hocuspocus/provider'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import type { RunInfo } from '../../../shared/protocol.ts'
import { CodeEditor } from '../editor/CodeEditor.tsx'
import { usePeers, useSynced, useYObserve } from '../lib/collab.ts'
import { diagnosticsOf, filesOf, listFiles, runOf } from '../lib/workspace.ts'

const RUN_LABEL: Record<string, string> = {
  compiling: '컴파일 중',
  running: '실행 중',
  exited: '실행 완료',
  'compile-error': '컴파일 에러',
  stopped: '중지됨',
}

interface Props {
  index: number
  name: string
  provider: HocuspocusProvider
  onOpen: () => void
  onRemove: () => void
}

/** Live, read-only preview of one tutee's current file on the tutor dashboard. */
export function TuteeCard({ index, name, provider, onOpen, onRemove }: Props) {
  const doc = provider.document
  const synced = useSynced(provider)
  const files = filesOf(doc)
  useYObserve(files)
  useYObserve(runOf(doc))
  useYObserve(diagnosticsOf(doc))
  const peers = usePeers(provider.awareness)
  const tutee = peers.find((p) => p.user?.role === 'tutee')

  const names = listFiles(doc)
  const file = tutee?.activeFile && names.includes(tutee.activeFile) ? tutee.activeFile : names[0]
  const ytext = file ? files.get(file) : undefined
  const run = runOf(doc).toJSON() as RunInfo
  const errors = diagnosticsOf(doc).toArray().filter((d) => d.severity === 'error').length

  // Keep the tutee's cursor in view.
  const view = useRef<EditorView | null>(null)
  const cursor = (tutee as any)?.cursor?.head
  useEffect(() => {
    const v = view.current
    if (!v || !cursor || !ytext) return
    const pos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor), doc)
    if (!pos || pos.type !== ytext) return
    const at = Math.min(pos.index, v.state.doc.length)
    v.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) })
  }, [cursor, ytext, doc])

  return (
    <article className="tutee-card" onClick={onOpen}>
      <header>
        <span className="card-index">{index}</span>
        <span className={`online-dot ${tutee ? 'on' : ''}`} title={tutee ? '접속 중' : '오프라인'} />
        <strong>{name}</strong>
        <span className="muted small">{file}</span>
        <span className="spacer" />
        {errors > 0 && run.state === 'compile-error' && <span className="badge error">에러 {errors}</span>}
        {run.state && RUN_LABEL[run.state] && run.state !== 'compile-error' && (
          <span className={`badge state-${run.state}`}>{RUN_LABEL[run.state]}</span>
        )}
        <button
          className="icon-btn"
          title="목록에서 삭제"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      </header>
      <div className="card-body">
        {synced && ytext && file ? (
          <CodeEditor
            ytext={ytext}
            fileName={file}
            awareness={provider.awareness}
            readOnly
            onView={(v) => (view.current = v)}
          />
        ) : (
          <div className="empty muted">{synced ? '파일 없음' : '불러오는 중…'}</div>
        )}
      </div>
    </article>
  )
}
