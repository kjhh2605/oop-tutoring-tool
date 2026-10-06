import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const
export type ImageExt = keyof typeof IMAGE_TYPES

/** Detects the image format from its magic bytes (the Content-Type header is not trusted; SVG is never accepted). */
export function sniffImage(buf: Buffer): ImageExt | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

const IMAGE_FILE = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/

/** Problem images uploaded by the tutor, stored under data/problems with random names. */
export class ImageStore {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'problems')
    mkdirSync(this.dir, { recursive: true })
  }

  async save(buf: Buffer, ext: ImageExt) {
    const file = `${randomBytes(8).toString('hex')}.${ext}`
    await writeFile(path.join(this.dir, file), buf)
    return file
  }

  /** Path and content type of a stored image, or null for unknown / malformed names. */
  async find(file: string) {
    const m = IMAGE_FILE.exec(file)
    if (!m) return null
    const full = path.join(this.dir, file)
    const info = await stat(full).catch(() => null)
    return info?.isFile() ? { path: full, size: info.size, type: IMAGE_TYPES[m[1] as ImageExt] } : null
  }

  async remove(file: string) {
    if (IMAGE_FILE.test(file)) await rm(path.join(this.dir, file), { force: true })
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
