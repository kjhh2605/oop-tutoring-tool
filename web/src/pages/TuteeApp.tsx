import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PROBLEM_DOC, tuteeDocName } from '../../../shared/protocol.ts'
import { Workspace } from '../components/Workspace.tsx'
import { createSocket, makeUser, openDoc, useConnectionStatus, useSynced } from '../lib/collab.ts'
import { loadJson, saveJson } from '../lib/storage.ts'

interface Identity {
  id: string
  name: string
  secret: string
}

const KEY = 'tutoring.tutee'

export function TuteeApp() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadJson<Identity>(KEY))

  const signOut = useCallback(() => {
    saveJson(KEY, null)
    setIdentity(null)
  }, [])

  if (!identity) {
    return (
      <JoinForm
        onJoined={(id) => {
          saveJson(KEY, id)
          setIdentity(id)
        }}
      />
    )
  }
  return <TuteeSession key={identity.id} identity={identity} onSignOut={signOut} />
}

function JoinForm({ onJoined }: { onJoined: (id: Identity) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/join', { method: 'POST', body: JSON.stringify({ name }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '입장에 실패했습니다.')
      onJoined(body)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <form className="card login" onSubmit={submit}>
        <h1>Java 튜토링</h1>
        <p className="muted">이름을 입력하고 입장하세요. 같은 이름으로 다시 들어오면 작성하던 코드가 그대로 열립니다.</p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" maxLength={20} />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !name.trim()}>
          입장
        </button>
      </form>
    </div>
  )
}

function TuteeSession({ identity, onSignOut }: { identity: Identity; onSignOut: () => void }) {
  const [state, setState] = useState<{
    provider: HocuspocusProvider
    problem: HocuspocusProvider
    socket: ReturnType<typeof createSocket>
  } | null>(null)

  useEffect(() => {
    const socket = createSocket()
    const token = JSON.stringify({ role: 'tutee', id: identity.id, secret: identity.secret })
    // Unknown identity (e.g. the tutor removed this tutee): go back to the join form.
    const provider = openDoc(socket, tuteeDocName(identity.id), token, { onAuthenticationFailed: onSignOut })
    provider.awareness!.setLocalStateField('user', makeUser(identity.name, 'tutee'))
    const problem = openDoc(socket, PROBLEM_DOC, token)
    setState({ provider, problem, socket })
    return () => {
      problem.destroy()
      provider.destroy()
      socket.destroy()
    }
  }, [identity, onSignOut])

  const synced = useSynced(state?.provider ?? null)
  const status = useConnectionStatus(state?.socket ?? null)

  if (!state || !synced) return <div className="center-screen muted">연결 중…</div>

  return (
    <div className="app">
      <Workspace
        provider={state.provider}
        role="tutee"
        problemDoc={state.problem.document}
        toolbar={
          <>
            {status !== 'connected' && <span className="badge offline">연결 끊김 · 재연결 중</span>}
            <span className="me">{identity.name}</span>
          </>
        }
      />
    </div>
  )
}
