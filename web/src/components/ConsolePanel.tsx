import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { RunCommand, RunInfo } from '../../../shared/protocol.ts'
import { useYObserve } from '../lib/collab.ts'
import { consoleOf, runOf } from '../lib/workspace.ts'

const STATUS: Record<string, string> = {
  idle: '대기',
  compiling: '컴파일 중…',
  running: '실행 중',
  exited: '종료',
  'compile-error': '컴파일 에러',
  stopped: '중지됨',
}

export function send(provider: HocuspocusProvider, cmd: RunCommand) {
  provider.sendStateless(JSON.stringify(cmd))
}

interface Props {
  provider: HocuspocusProvider
  activeFile: string
  /** Ref the workspace can use to trigger a run (Ctrl/Cmd+Enter). */
  runRef?: React.MutableRefObject<(() => void) | null>
}

export function ConsolePanel({ provider, activeFile, runRef }: Props) {
  const doc = provider.document
  const entries = consoleOf(doc)
  const runMap = runOf(doc)
  useYObserve(entries)
  useYObserve(runMap)
  const run = runMap.toJSON() as RunInfo
  const state = run.state ?? 'idle'
  const busy = state === 'compiling' || state === 'running'

  const [input, setInput] = useState('')
  const outRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)
  const startedHere = useRef(false)

  const start = () => {
    startedHere.current = true
    send(provider, { type: 'run', file: activeFile })
  }
  if (runRef) runRef.current = start

  useEffect(() => {
    if (state === 'running' && startedHere.current) {
      startedHere.current = false
      inputRef.current?.focus()
    }
  }, [state])

  useLayoutEffect(() => {
    const el = outRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (state !== 'running') return
    send(provider, { type: 'stdin', line: input })
    setInput('')
  }

  let label = STATUS[state] ?? state
  if (state === 'running' && run.mainClass) label += ` · ${run.mainClass}`
  if (state === 'exited' && run.exitCode != null) label += ` · code ${run.exitCode}`
  if (run.by === 'tutor' && state !== 'idle') label += ' (튜터가 실행)'

  return (
    <section className="console">
      <header className="console-bar">
        <button className="btn run" onClick={start} disabled={state === 'compiling'} title="실행 (Ctrl/⌘ + Enter)">
          ▶ 실행
        </button>
        <button className="btn stop" onClick={() => send(provider, { type: 'stop' })} disabled={!busy}>
          ■ 중지
        </button>
        <span className={`run-state state-${state}`}>{label}</span>
      </header>
      <pre
        className="console-out"
        ref={outRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        onClick={() => state === 'running' && inputRef.current?.focus()}
      >
        {entries.toArray().map((e, i) => (
          <span key={i} className={`c-${e.t}`}>
            {e.s}
          </span>
        ))}
        {entries.length === 0 && <span className="c-hint">▶ 실행을 누르면 결과가 여기에 표시됩니다.</span>}
      </pre>
      <form className="console-in" onSubmit={submit}>
        <span className="prompt">{state === 'running' ? '입력 ›' : '　'}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={state !== 'running'}
          placeholder={state === 'running' ? '프로그램에 보낼 입력을 쓰고 Enter' : '프로그램 실행 중에 입력할 수 있습니다'}
          spellCheck={false}
          autoComplete="off"
        />
      </form>
    </section>
  )
}
