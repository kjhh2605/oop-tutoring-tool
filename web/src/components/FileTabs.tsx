import type * as Y from 'yjs'
import type { Peer } from '../lib/collab.ts'
import { createClassFile, deleteFile, diagnosticsOf, listFiles, renameClassFile } from '../lib/workspace.ts'

interface Props {
  doc: Y.Doc
  active: string
  onSelect: (file: string) => void
  peers: Peer[]
}

export function FileTabs({ doc, active, onSelect, peers }: Props) {
  const files = listFiles(doc)
  const errors = new Map<string, number>()
  for (const d of diagnosticsOf(doc).toArray()) {
    if (d.severity === 'error') errors.set(d.file, (errors.get(d.file) ?? 0) + 1)
  }

  const create = () => {
    const name = window.prompt('새 클래스 이름 (예: Dog)')?.trim()
    if (!name) return
    const error = createClassFile(doc, name)
    if (error) window.alert(error)
    else onSelect(`${name}.java`)
  }

  const rename = (file: string) => {
    const name = window.prompt('새 클래스 이름', file.replace(/\.java$/, ''))?.trim()
    if (!name) return
    const error = renameClassFile(doc, file, name)
    if (error) window.alert(error)
    else if (file === active) onSelect(`${name}.java`)
  }

  const remove = (file: string) => {
    if (!window.confirm(`${file} 파일을 삭제할까요? 되돌릴 수 없습니다.`)) return
    deleteFile(doc, file)
  }

  return (
    <div className="tabs" role="tablist">
      {files.map((file) => {
        const here = peers.filter((p) => p.activeFile === file && p.user)
        return (
          <div
            key={file}
            role="tab"
            aria-selected={file === active}
            className={`tab ${file === active ? 'active' : ''}`}
            onClick={() => onSelect(file)}
            onDoubleClick={() => rename(file)}
            title="더블클릭: 이름 변경"
          >
            {here.map((p) => (
              <span key={p.clientId} className="peer-dot" style={{ background: p.user!.color }} title={`${p.user!.name} 보는 중`} />
            ))}
            <span className="tab-name">{file}</span>
            {errors.get(file) ? <span className="tab-errors">{errors.get(file)}</span> : null}
            <button
              className="tab-close"
              title="삭제"
              onClick={(e) => {
                e.stopPropagation()
                remove(file)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button className="tab-add" onClick={create} title="새 클래스 파일">
        + 클래스
      </button>
    </div>
  )
}
