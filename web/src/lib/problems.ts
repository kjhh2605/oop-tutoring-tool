import type * as Y from 'yjs'
import { IMAGE_API, K_POSTED, K_PROBLEMS, problemImageUrl, type ProblemEntry } from '../../../shared/protocol.ts'

export interface Problem extends ProblemEntry {
  id: string
}

export const problemsOf = (doc: Y.Doc) => doc.getMap<ProblemEntry>(K_PROBLEMS)
export const postedOf = (doc: Y.Doc) => doc.getMap<string | null>(K_POSTED)

/** Problems in creation order. */
export function listProblems(doc: Y.Doc): Problem[] {
  return [...problemsOf(doc).entries()].map(([id, p]) => ({ id, ...p })).sort((a, b) => a.createdAt - b.createdAt)
}

export function postedProblem(doc: Y.Doc): Problem | null {
  const id = postedOf(doc).get('id')
  const p = id ? problemsOf(doc).get(id) : undefined
  return id && p ? { id, ...p } : null
}

export function createProblem(doc: Y.Doc): string {
  const id = Math.random().toString(36).slice(2, 10)
  const title = `문제 ${problemsOf(doc).size + 1}`
  problemsOf(doc).set(id, { title, images: [], createdAt: Date.now() })
  return id
}

export function updateProblem(doc: Y.Doc, id: string, fn: (p: ProblemEntry) => Partial<ProblemEntry>) {
  const problems = problemsOf(doc)
  const p = problems.get(id)
  if (p) problems.set(id, { ...p, ...fn(p) })
}

export function setPosted(doc: Y.Doc, id: string | null) {
  postedOf(doc).set('id', id)
}

export function deleteProblem(doc: Y.Doc, id: string) {
  doc.transact(() => {
    problemsOf(doc).delete(id)
    if (postedOf(doc).get('id') === id) postedOf(doc).set('id', null)
  })
}

const tutorHeader = (code: string) => ({ 'X-Tutor-Code': encodeURIComponent(code) })

/** Uploads one image and returns its stored file name. */
export async function uploadImage(code: string, file: Blob): Promise<string> {
  const res = await fetch(IMAGE_API, { method: 'POST', headers: tutorHeader(code), body: file })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? '이미지를 올리지 못했습니다.')
  return body.file
}

export async function deleteImage(code: string, file: string) {
  await fetch(problemImageUrl(file), { method: 'DELETE', headers: tutorHeader(code) }).catch(() => {})
}
