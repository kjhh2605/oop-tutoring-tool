import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RosterEntry } from '../shared/protocol.ts'

/** Y.Doc states are stored as one binary file per document under data/docs. */
export class DocStore {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'docs')
    mkdirSync(this.dir, { recursive: true })
  }

  private file(docName: string) {
    return path.join(this.dir, encodeURIComponent(docName) + '.bin')
  }

  async load(docName: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(docName)))
    } catch {
      return null
    }
  }

  async save(docName: string, state: Uint8Array) {
    const target = this.file(docName)
    const tmp = target + '.tmp'
    await writeFile(tmp, state)
    await rename(tmp, target)
  }
}

export interface TuteeRecord extends RosterEntry {
  id: string
  secret: string
}

/** Registered tutees, persisted to data/roster.json. Names are unique (rejoining reuses the workspace). */
export class Roster {
  private readonly file: string
  private tutees: TuteeRecord[] = []

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'roster.json')
    if (existsSync(this.file)) {
      try {
        this.tutees = JSON.parse(readFileSync(this.file, 'utf8')).tutees ?? []
      } catch {
        this.tutees = []
      }
    }
  }

  list() {
    return [...this.tutees]
  }

  get(id: string) {
    return this.tutees.find((t) => t.id === id)
  }

  async join(name: string): Promise<{ record: TuteeRecord; created: boolean }> {
    const existing = this.tutees.find((t) => t.name === name)
    if (existing) return { record: existing, created: false }
    const record: TuteeRecord = {
      id: randomBytes(6).toString('hex'),
      secret: randomBytes(16).toString('hex'),
      name,
      joinedAt: Date.now(),
    }
    this.tutees.push(record)
    await this.persist()
    return { record, created: true }
  }

  async remove(id: string) {
    this.tutees = this.tutees.filter((t) => t.id !== id)
    await this.persist()
  }

  private async persist() {
    const tmp = this.file + '.tmp'
    await writeFile(tmp, JSON.stringify({ tutees: this.tutees }, null, 2))
    await rename(tmp, this.file)
  }
}
