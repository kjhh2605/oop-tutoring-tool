import type { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type * as Y from 'yjs'
import { K_TUTEES, PROBLEM_DOC, ROSTER_DOC, tuteeDocName, type RosterCommand, type RosterEntry } from '../../../shared/protocol.ts'
import { ProblemManager } from '../components/ProblemManager.tsx'
import { TuteeCard } from '../components/TuteeCard.tsx'
import { Workspace } from '../components/Workspace.tsx'
import { createSocket, makeUser, openDoc, useConnectionStatus, usePeers, useSynced, useYObserve } from '../lib/collab.ts'
import { postedOf, postedProblem, problemsOf } from '../lib/problems.ts'
import { loadJson, saveJson } from '../lib/storage.ts'

const KEY = 'tutoring.tutorCode'

export function TutorApp() {
  const [code, setCode] = useState<string | null>(() => loadJson<string>(KEY))
  const signOut = useCallback(() => {
    saveJson(KEY, null)
    setCode(null)
  }, [])
  if (!code) {
    return (
      <TutorLogin
        onLogin={(c) => {
          saveJson(KEY, c)
          setCode(c)
        }}
      />
    )
  }
  return <TutorSession code={code} onSignOut={signOut} />
}

function TutorLogin({ onLogin }: { onLogin: (code: string) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/tutor', { method: 'POST', body: JSON.stringify({ code }) })
    if (res.ok) onLogin(code)
    else setError('튜터 코드가 올바르지 않습니다. 서버 터미널에 표시된 코드를 입력하세요.')
  }
  return (
    <div className="center-screen">
      <form className="card login" onSubmit={submit}>
        <h1>튜터 로그인</h1>
        <p className="muted">서버를 실행한 터미널에 표시된 튜터 코드를 입력하세요.</p>
        <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="튜터 코드" inputMode="numeric" />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={!code}>
          로그인
        </button>
      </form>
    </div>
  )
}

interface TuteeConn {
  id: string
  provider: HocuspocusProvider
}

function TutorSession({ code, onSignOut }: { code: string; onSignOut: () => void }) {
  const token = JSON.stringify({ role: 'tutor', code })
  const [socket, setSocket] = useState<HocuspocusProviderWebsocket | null>(null)
  const [roster, setRoster] = useState<HocuspocusProvider | null>(null)
  const [problem, setProblem] = useState<HocuspocusProvider | null>(null)

  useEffect(() => {
    const s = createSocket()
    const r = openDoc(s, ROSTER_DOC, token, { onAuthenticationFailed: onSignOut })
    const p = openDoc(s, PROBLEM_DOC, token)
    setSocket(s)
    setRoster(r)
    setProblem(p)
    return () => {
      p.destroy()
      r.destroy()
      s.destroy()
    }
  }, [token, onSignOut])

  const synced = useSynced(roster)
  const status = useConnectionStatus(socket)
  const tuteeMap = roster?.document.getMap<RosterEntry>(K_TUTEES)
  useYObserve(tuteeMap)
  const rosterKey = JSON.stringify(tuteeMap?.toJSON() ?? {})
  const tutees = useMemo(
    () =>
      Object.entries(JSON.parse(rosterKey) as Record<string, RosterEntry>)
        .map(([id, e]) => ({ id, ...e }))
        .sort((a, b) => a.joinedAt - b.joinedAt),
    [rosterKey],
  )

  // One provider per tutee workspace, all multiplexed over the same websocket.
  const conns = useRef(new Map<string, TuteeConn>())
  const [, force] = useState(0)
  useEffect(() => {
    if (!socket) return
    const ids = new Set(tutees.map((t) => t.id))
    let changed = false
    for (const t of tutees) {
      if (conns.current.has(t.id)) continue
      const provider = openDoc(socket, tuteeDocName(t.id), token)
      provider.awareness!.setLocalStateField('user', makeUser('튜터', 'tutor'))
      provider.awareness!.setLocalStateField('viewing', false)
      conns.current.set(t.id, { id: t.id, provider })
      changed = true
    }
    for (const [id, c] of conns.current) {
      if (!ids.has(id)) {
        c.provider.destroy()
        conns.current.delete(id)
        changed = true
      }
    }
    if (changed) force((x) => x + 1)
  }, [socket, tutees, token])
  useEffect(() => {
    const map = conns.current
    return () => {
      for (const c of map.values()) c.provider.destroy()
      map.clear()
    }
  }, [])

  const [focusId, setFocusId] = useState<string | null>(null)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const closeProblems = useCallback(() => setProblemsOpen(false), [])
  const focused = focusId ? conns.current.get(focusId) : undefined

  // Tell the focused tutee that the tutor is looking.
  useEffect(() => {
    for (const [id, c] of conns.current) c.provider.awareness!.setLocalStateField('viewing', id === focusId)
  }, [focusId, tutees])

  // Esc: back to dashboard. Alt+1..9: jump to tutee N.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const t = tutees[Number(e.code.slice(5)) - 1]
        if (t) {
          e.preventDefault()
          e.stopPropagation()
          setFocusId(t.id)
        }
      } else if (e.key === 'Escape' && focusId && !e.defaultPrevented && !document.querySelector('.overlay')) {
        // Open dialogs / image zoom close themselves on Esc first.
        setFocusId(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tutees, focusId])

  const removeTutee = (id: string, name: string) => {
    if (!window.confirm(`${name} 님을 목록에서 삭제할까요? (작성한 코드는 서버에 남습니다)`)) return
    roster?.sendStateless(JSON.stringify({ type: 'removeTutee', id } satisfies RosterCommand))
    if (focusId === id) setFocusId(null)
  }

  if (!roster || !problem || !synced) return <div className="center-screen muted">연결 중…</div>

  const offline = status !== 'connected' && <span className="badge offline">연결 끊김 · 재연결 중</span>
  const problems = (
    <>
      <ProblemButton doc={problem.document} onClick={() => setProblemsOpen(true)} />
      {problemsOpen && <ProblemManager doc={problem.document} code={code} onClose={closeProblems} />}
    </>
  )

  if (focused) {
    const entry = tutees.find((t) => t.id === focusId)
    return (
      <div className="app">
        <nav className="tutor-nav">
          <button className="btn ghost" onClick={() => setFocusId(null)} title="Esc">
            ← 전체 보기
          </button>
          {tutees.map((t, i) => (
            <button
              key={t.id}
              className={`btn chip ${t.id === focusId ? 'active' : ''}`}
              onClick={() => setFocusId(t.id)}
              title={`Alt+${i + 1}`}
            >
              <OnlineDot provider={conns.current.get(t.id)?.provider} /> {t.name}
            </button>
          ))}
          <span className="spacer" />
          {problems}
          {offline}
          <span className="me tutor">튜터</span>
        </nav>
        <FocusedWorkspace key={focusId} provider={focused.provider} name={entry?.name ?? ''} problemDoc={problem.document} />
      </div>
    )
  }

  return (
    <div className="app">
      <nav className="tutor-nav">
        <strong>튜티 {tutees.length}명</strong>
        <span className="muted small">카드를 클릭하거나 Alt+번호로 들어가 바로 수정할 수 있습니다 · Esc로 돌아오기</span>
        <span className="spacer" />
        {problems}
        {offline}
        <span className="me tutor">튜터</span>
      </nav>
      {tutees.length === 0 ? (
        <div className="center-screen muted">
          아직 입장한 튜티가 없습니다. 튜티는 같은 Wi-Fi에서 {window.location.host} 에 접속하면 됩니다.
        </div>
      ) : (
        <main className={`grid n${Math.min(tutees.length, 4)}`}>
          {tutees.map((t, i) => {
            const c = conns.current.get(t.id)
            return c ? (
              <TuteeCard
                key={t.id}
                index={i + 1}
                name={t.name}
                provider={c.provider}
                onOpen={() => setFocusId(t.id)}
                onRemove={() => removeTutee(t.id, t.name)}
              />
            ) : null
          })}
        </main>
      )}
    </div>
  )
}

function FocusedWorkspace({ provider, name, problemDoc }: { provider: HocuspocusProvider; name: string; problemDoc: Y.Doc }) {
  const synced = useSynced(provider)
  const peers = usePeers(provider.awareness)
  if (!synced) return <div className="center-screen muted">불러오는 중…</div>
  const tutee = peers.find((p) => p.user?.role === 'tutee')
  return (
    <Workspace
      provider={provider}
      role="tutor"
      initialFile={tutee?.activeFile}
      problemDoc={problemDoc}
      toolbar={<span className="muted small">{name} 님의 코드 · 입력하면 튜티 화면에 바로 반영됩니다</span>}
    />
  )
}

function ProblemButton({ doc, onClick }: { doc: Y.Doc; onClick: () => void }) {
  useYObserve(problemsOf(doc))
  useYObserve(postedOf(doc))
  const posted = postedProblem(doc)
  return (
    <button className={`btn ${posted ? 'posted' : 'ghost'}`} onClick={onClick} title="문제 이미지를 올리고 튜티 화면에 게시합니다">
      📋 {posted ? `${posted.title} 게시 중` : '문제 게시'}
    </button>
  )
}

function OnlineDot({ provider }: { provider?: HocuspocusProvider }) {
  const peers = usePeers(provider?.awareness)
  const online = peers.some((p) => p.user?.role === 'tutee')
  return <span className={`online-dot ${online ? 'on' : ''}`} title={online ? '접속 중' : '오프라인'} />
}
