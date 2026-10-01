import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '../../../shared/protocol.ts'
import { CodeEditor } from '../editor/CodeEditor.tsx'
import { usePeers, useYObserve } from '../lib/collab.ts'
import { loadJson, saveJson } from '../lib/storage.ts'
import { clearMarks, diagnosticsOf, filesOf, hasMarks, listFiles, marksOf } from '../lib/workspace.ts'
import { ConsolePanel } from './ConsolePanel.tsx'
import { FileTabs } from './FileTabs.tsx'

interface Props {
  provider: HocuspocusProvider
  role: Role
  initialFile?: string
  toolbar?: ReactNode
}

const FOLLOW_KEY = 'tutoring.followTutee'

export function Workspace({ provider, role, initialFile, toolbar }: Props) {
  const doc = provider.document
  const awareness = provider.awareness!
  const files = filesOf(doc)
  useYObserve(files)
  useYObserve(diagnosticsOf(doc))
  useYObserve(marksOf(doc))
  const peers = usePeers(awareness)

  const names = listFiles(doc)
  const [selected, setSelected] = useState(initialFile ?? 'Main.java')
  const active = names.includes(selected) ? selected : names[0]
  const ytext = active ? files.get(active) : undefined

  useEffect(() => {
    awareness.setLocalStateField('activeFile', active)
  }, [awareness, active])

  const tutor = peers.find((p) => p.user?.role === 'tutor')
  const tutee = peers.find((p) => p.user?.role === 'tutee')
  const tuteeFile = tutee?.activeFile

  // Tutor follows the tutee's tab switches. The tutor may still open another tab; it is kept until the tutee switches again.
  const [follow, setFollow] = useState(() => loadJson<boolean>(FOLLOW_KEY) ?? true)
  const lastTuteeFile = useRef(tuteeFile)
  useEffect(() => {
    if (role !== 'tutor') return
    if (follow && tuteeFile && tuteeFile !== lastTuteeFile.current) setSelected(tuteeFile)
    lastTuteeFile.current = tuteeFile
  }, [role, follow, tuteeFile])

  const toggleFollow = () => {
    const next = !follow
    setFollow(next)
    saveJson(FOLLOW_KEY, next)
    if (next && tuteeFile) setSelected(tuteeFile)
  }

  const runRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        runRef.current?.()
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault() // everything is saved automatically
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const marked = hasMarks(doc)

  return (
    <div className="workspace">
      <div className="ws-bar">
        <FileTabs doc={doc} active={active ?? ''} onSelect={setSelected} peers={peers} />
        <div className="ws-tools">
          {role === 'tutee' && tutor?.viewing && <span className="badge viewing">👀 튜터가 보고 있어요</span>}
          {role === 'tutor' && (
            <label className="follow" title="튜티가 다른 파일로 이동하면 함께 이동합니다">
              <input type="checkbox" checked={follow} onChange={toggleFollow} />
              튜티 따라가기
            </label>
          )}
          {role === 'tutor' && tuteeFile && tuteeFile !== active && (
            <button className="btn ghost" onClick={() => setSelected(tuteeFile)}>
              튜티 파일로 ({tuteeFile})
            </button>
          )}
          {marked && (
            <button className="btn ghost marks" onClick={() => clearMarks(doc)} title="주황색 하이라이트는 튜터가 입력한 부분입니다">
              {role === 'tutee' ? '튜터 수정 확인 ✓' : '수정 표시 지우기'}
            </button>
          )}
          {toolbar}
        </div>
      </div>
      <div className="ws-editor">
        {ytext && active ? (
          <CodeEditor
            key={`${active}`}
            ytext={ytext}
            fileName={active}
            awareness={awareness}
            recordTutorMarks={role === 'tutor'}
            autoFocus
          />
        ) : (
          <div className="empty">파일이 없습니다. “+ 클래스”로 새 파일을 만드세요.</div>
        )}
      </div>
      <ConsolePanel provider={provider} activeFile={active ?? ''} runRef={runRef} />
    </div>
  )
}
