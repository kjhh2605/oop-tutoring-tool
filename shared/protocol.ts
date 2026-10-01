// Shared between server and web client.

export const COLLAB_PATH = '/collab'
export const ROSTER_DOC = 'roster'
export const TUTEE_DOC_PREFIX = 'tutee/'

export const tuteeDocName = (id: string) => `${TUTEE_DOC_PREFIX}${id}`

// Keys inside a tutee Y.Doc
export const K_FILES = 'files' // Y.Map<Y.Text>
export const K_RUN = 'run' // Y.Map: RunInfo fields
export const K_CONSOLE = 'console' // Y.Array<ConsoleEntry>
export const K_DIAGNOSTICS = 'diagnostics' // Y.Array<JavaDiagnostic>
export const K_MARKS = 'marks' // Y.Map<fileName, Y.Array<TutorMark>>

// Keys inside the roster Y.Doc
export const K_TUTEES = 'tutees' // Y.Map<id, RosterEntry>

export type Role = 'tutor' | 'tutee'

export type AuthToken =
  | { role: 'tutor'; code: string }
  | { role: 'tutee'; id: string; secret: string }

export interface RosterEntry {
  name: string
  joinedAt: number
}

export type RunState = 'idle' | 'compiling' | 'running' | 'exited' | 'compile-error' | 'stopped'

export interface RunInfo {
  state: RunState
  exitCode?: number | null
  mainClass?: string
  by?: Role
}

export type ConsoleKind = 'out' | 'err' | 'in' | 'sys'
export interface ConsoleEntry {
  t: ConsoleKind
  s: string
}

export interface JavaDiagnostic {
  file: string
  line: number // 1-based
  col: number // 1-based
  severity: 'error' | 'warning'
  message: string
}

// Relative positions serialized with Y.relativePositionToJSON
export interface TutorMark {
  a: unknown
  b: unknown
}

// Client -> server stateless commands on a tutee doc
export type RunCommand =
  | { type: 'run'; file?: string }
  | { type: 'stdin'; line: string }
  | { type: 'stop' }

// Client -> server stateless commands on the roster doc (tutor only)
export type RosterCommand = { type: 'removeTutee'; id: string }

export interface AwarenessUser {
  name: string
  color: string
  colorLight: string
  role: Role
}

// Awareness fields set by clients (besides y-codemirror's `cursor`)
export interface PresenceState {
  user?: AwarenessUser
  activeFile?: string
  viewing?: boolean // tutor is looking at this tutee in focus view
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const JAVA_KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield'.split(
    ' ',
  ),
)

export function validateClassName(name: string): string | null {
  if (!name) return '클래스 이름을 입력하세요.'
  if (!IDENT.test(name)) return '영문자, 숫자, _, $만 사용할 수 있고 숫자로 시작할 수 없습니다.'
  if (JAVA_KEYWORDS.has(name)) return `'${name}'은(는) Java 예약어라 사용할 수 없습니다.`
  return null
}

export const isJavaFileName = (file: string) => file.endsWith('.java') && IDENT.test(file.slice(0, -5))

export const classTemplate = (name: string) => `public class ${name} {\n    \n}\n`

export const MAIN_TEMPLATE = `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, Java!");
    }
}
`
