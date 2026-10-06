import { useEffect, useRef, useState, type DragEvent } from 'react'
import type * as Y from 'yjs'
import { useYObserve } from '../lib/collab.ts'
import { ProblemImage } from './ProblemPanel.tsx'
import {
  createProblem,
  deleteImage,
  deleteProblem,
  listProblems,
  postedOf,
  problemsOf,
  setPosted,
  updateProblem,
  uploadImage,
} from '../lib/problems.ts'

interface Props {
  doc: Y.Doc
  code: string
  onClose: () => void
}

/** Tutor-only dialog: add problem images (paste / drop / pick) and choose which problem tutees see. */
export function ProblemManager({ doc, code, onClose }: Props) {
  useYObserve(problemsOf(doc))
  useYObserve(postedOf(doc))
  const problems = listProblems(doc)
  const postedId = postedOf(doc).get('id') ?? null

  const [selectedId, setSelectedId] = useState<string | null>(() => postedId ?? problems.at(-1)?.id ?? null)
  const selected = problems.find((p) => p.id === selectedId) ?? null
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const addImages = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (imgs.length === 0) return
    const id = selected?.id ?? createProblem(doc)
    setSelectedId(id)
    setError('')
    setUploading((n) => n + imgs.length)
    // One at a time so the images keep the order they were pasted / picked in.
    for (const img of imgs) {
      try {
        const file = await uploadImage(code, img)
        updateProblem(doc, id, (p) => ({ images: [...p.images, file] }))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }
  const addRef = useRef(addImages)
  addRef.current = addImages

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length === 0) return
      e.preventDefault()
      void addRef.current(files)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    void addImages([...e.dataTransfer.files])
  }

  const moveImage = (index: number, by: number) => {
    if (!selected) return
    updateProblem(doc, selected.id, (p) => {
      const images = [...p.images]
      const [img] = images.splice(index, 1)
      images.splice(index + by, 0, img)
      return { images }
    })
  }

  const rotateImage = (file: string) => {
    if (!selected) return
    updateProblem(doc, selected.id, (p) => ({
      rotations: { ...p.rotations, [file]: ((p.rotations?.[file] ?? 0) + 90) % 360 },
    }))
  }

  const removeImage = (file: string) => {
    if (!selected) return
    updateProblem(doc, selected.id, (p) => {
      const { [file]: _, ...rotations } = p.rotations ?? {}
      return { images: p.images.filter((f) => f !== file), rotations }
    })
    void deleteImage(code, file)
  }

  const removeProblem = () => {
    if (!selected || !window.confirm(`'${selected.title}'을(를) 삭제할까요?`)) return
    deleteProblem(doc, selected.id)
    for (const file of selected.images) void deleteImage(code, file)
    setSelectedId(null)
  }

  const isPosted = !!selected && selected.id === postedId

  return (
    <div className="overlay modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal problem-manager" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <header className="modal-head">
          <strong>문제 게시</strong>
          <span className="muted small">게시한 문제는 모든 튜티 화면 왼쪽에 바로 표시됩니다</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} title="닫기 (Esc)">
            ✕
          </button>
        </header>
        <div className="pm-body">
          <nav className="pm-list">
            {problems.map((p) => (
              <button
                key={p.id}
                className={`pm-item ${p.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="pm-title">{p.title}</span>
                <span className="muted small">{p.images.length}장</span>
                {p.id === postedId && <span className="badge posted">게시 중</span>}
              </button>
            ))}
            <button className="tab-add" onClick={() => setSelectedId(createProblem(doc))}>
              + 새 문제
            </button>
          </nav>
          <section className="pm-detail">
            {selected ? (
              <div className="pm-actions">
                <input
                  key={selected.id}
                  className="pm-title-input"
                  defaultValue={selected.title}
                  onChange={(e) => updateProblem(doc, selected.id, () => ({ title: e.target.value.trim() || '문제' }))}
                  placeholder="문제 제목"
                />
                {isPosted ? (
                  <button className="btn" onClick={() => setPosted(doc, null)}>
                    게시 내리기
                  </button>
                ) : (
                  <button className="btn run" onClick={() => setPosted(doc, selected.id)} disabled={selected.images.length === 0}>
                    이 문제 게시
                  </button>
                )}
                <button className="btn ghost" onClick={removeProblem}>
                  삭제
                </button>
              </div>
            ) : (
              <p className="muted">이미지를 붙여넣으면 새 문제가 만들어집니다.</p>
            )}
            <button className="pm-drop" onClick={() => fileInput.current?.click()}>
              {uploading > 0 ? `올리는 중… (${uploading})` : '이미지 붙여넣기(⌘/Ctrl+V) · 끌어다 놓기 · 클릭해서 선택'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void addImages([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            {error && <p className="error">{error}</p>}
            {selected && (
              <PmImages
                images={selected.images}
                rotations={selected.rotations}
                onMove={moveImage}
                onRotate={rotateImage}
                onRemove={removeImage}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function PmImages({
  images,
  rotations,
  onMove,
  onRotate,
  onRemove,
}: {
  images: string[]
  rotations?: Record<string, number>
  onMove: (index: number, by: number) => void
  onRotate: (file: string) => void
  onRemove: (file: string) => void
}) {
  return (
    <div className="pm-images">
      {images.map((file, i) => (
        <figure key={file} className="pm-image">
          <ProblemImage file={file} rotation={rotations?.[file]} />
          <div className="pm-image-tools">
            <button className="icon-btn" onClick={() => onRotate(file)} title="오른쪽으로 90° 회전">
              ⟳
            </button>
            <button className="icon-btn" onClick={() => onMove(i, -1)} disabled={i === 0} title="위로">
              ↑
            </button>
            <button className="icon-btn" onClick={() => onMove(i, 1)} disabled={i === images.length - 1} title="아래로">
              ↓
            </button>
            <button className="icon-btn" onClick={() => onRemove(file)} title="이미지 삭제">
              ✕
            </button>
          </div>
        </figure>
      ))}
    </div>
  )
}
