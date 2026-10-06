import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type * as Y from 'yjs'
import { problemImageUrl } from '../../../shared/protocol.ts'
import { useYObserve } from '../lib/collab.ts'
import { postedOf, postedProblem, problemsOf } from '../lib/problems.ts'
import { loadJson, saveJson } from '../lib/storage.ts'

const OPEN_KEY = 'tutoring.problemOpen'
const WIDTH_KEY = 'tutoring.problemWidth'
const MIN_WIDTH = 220

const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, MIN_WIDTH), window.innerWidth * 0.7))

/** The posted problem, shown left of the editor. Hidden while nothing is posted. */
export function ProblemPanel({ doc }: { doc: Y.Doc }) {
  useYObserve(problemsOf(doc))
  useYObserve(postedOf(doc))
  const problem = postedProblem(doc)

  const [open, setOpen] = useState(() => loadJson<boolean>(OPEN_KEY) ?? true)
  const [width, setWidth] = useState(() => loadJson<number>(WIDTH_KEY) ?? 420)
  const [zoom, setZoom] = useState<string | null>(null)

  const toggle = (next: boolean) => {
    setOpen(next)
    saveJson(OPEN_KEY, next)
  }

  // A newly posted problem always opens the panel.
  const lastId = useRef(problem?.id)
  useEffect(() => {
    if (problem && problem.id !== lastId.current) {
      setOpen(true)
      saveJson(OPEN_KEY, true)
    }
    lastId.current = problem?.id
  }, [problem])

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: PointerEvent) => setWidth(clampWidth(startW + ev.clientX - startX))
    const up = (ev: PointerEvent) => {
      saveJson(WIDTH_KEY, clampWidth(startW + ev.clientX - startX))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!problem) return null

  if (!open) {
    return (
      <button className="problem-tab" onClick={() => toggle(true)} title="문제 보기">
        📋 문제
      </button>
    )
  }

  return (
    <aside className="problem-panel" style={{ width: clampWidth(width) }}>
      <header className="problem-head">
        <strong>📋 {problem.title}</strong>
        <span className="muted small">클릭하면 크게 보기</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => toggle(false)} title="문제 접기">
          «
        </button>
      </header>
      <div className="problem-images">
        {problem.images.map((file) => (
          <ProblemImage key={file} file={file} rotation={problem.rotations?.[file]} onClick={() => setZoom(file)} />
        ))}
      </div>
      <div className="problem-resize" onPointerDown={startResize} title="드래그해서 너비 조절" />
      {zoom && <ImageZoom file={zoom} rotation={problem.rotations?.[zoom]} onClose={() => setZoom(null)} />}
    </aside>
  )
}

/** Full-screen view of one image; click or Esc closes. */
export function ImageZoom({ file, rotation, onClose }: { file: string; rotation?: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay lightbox" onClick={onClose}>
      <ProblemImage file={file} rotation={rotation} />
    </div>
  )
}

/**
 * A problem image turned by `rotation` degrees clockwise. Quarter turns swap width and height, so the image sits in a
 * box with the rotated aspect ratio and is sized from it with container units.
 */
export function ProblemImage({ file, rotation = 0, onClick }: { file: string; rotation?: number; onClick?: () => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const src = problemImageUrl(file)
  if (rotation % 180 === 0) {
    return <img src={src} alt="" onClick={onClick} style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined} />
  }
  const turned: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '100cqh',
    height: '100cqw',
    maxWidth: 'none',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  }
  return (
    <div
      className="rot-box"
      onClick={onClick}
      style={size ? { aspectRatio: `${size.h} / ${size.w}`, maxWidth: size.h } : undefined}
    >
      <img
        src={src}
        alt=""
        style={turned}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
    </div>
  )
}
