/**
 * Workspace files: every file under `files/` is one workspace file, its key the path below
 * `files/` (folder path, then name). The bytes travel as a blob by SHA-256, so the declaration is
 * only the hash and size; a file's folders are its path's segments.
 *
 * A path is refused when no workspace file could hold it or when two paths would land on one file
 * on a case-insensitive disk, so a directory always round-trips through a get on any machine.
 */
import type { Json, SourceSpan } from '@sim/workflow-code'
import { utf8Bytes } from '@sim/workflow-code/limits'
import { diagnostic, type WorkspaceDiagnostic, type WorkspaceDiagnosticCode } from '../diagnostics'
import { type BlobEntry, KIND_DIRS, type KindCodec } from '../kind'
import { isFileKey } from '../layout'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'

export interface FileDecl {
  /** Lowercase hex SHA-256 of the bytes. */
  sha256: string
  size: number
}

const SHA256 = /^[0-9a-f]{64}$/
/** Names Windows reserves for devices, with or without an extension. */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const MAX_SEGMENT_BYTES = 255
const MAX_KEY_LENGTH = 1024

/** The directory path of a file's bytes: `files/<key>`. */
export function fileBlobPath(key: string): string {
  return `${KIND_DIRS.file}/${key}`
}

/**
 * Why no directory can hold a file at `key` (its path under `files/`), or `null` when one can: a
 * dot or empty segment, a hidden name, a control or reserved character, a trailing space or dot,
 * a reserved device name, or a name over 255 bytes.
 */
export function filePathProblem(key: string): string | null {
  if (key.length > MAX_KEY_LENGTH) return `the path is over ${MAX_KEY_LENGTH} characters`
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return 'the path has an empty or dot segment'
    }
    if (segment.startsWith('.')) return `"${segment}" starts with a dot`
    if (/[ .]$/.test(segment)) return `"${segment}" ends with a space or a dot`
    if (RESERVED_NAME.test(segment)) return `"${segment}" is a reserved device name`
    if (utf8Bytes(segment) > MAX_SEGMENT_BYTES) {
      return `"${segment.slice(0, 32)}…" is over ${MAX_SEGMENT_BYTES} bytes`
    }
  }
  return isFileKey(key) ? null : 'the path holds a control or reserved character'
}

/** The spelling two paths share when a case-insensitive disk would store them as one. */
export function foldedFileKey(key: string): string {
  return key.normalize('NFC').toLowerCase()
}

function spanOf(path: string): SourceSpan {
  return { file: path, line: 1, column: 1, endLine: 1, endColumn: 1, start: 0, end: 0 }
}

function pathFinding(
  code: WorkspaceDiagnosticCode,
  path: string,
  message: string,
  hint?: string
): WorkspaceDiagnostic {
  return diagnostic(code, message, {
    kind: 'file',
    key: path.slice(KIND_DIRS.file.length + 1),
    span: spanOf(path),
    ...(hint ? { hint } : {}),
  })
}

function groupFiles(paths: readonly string[]) {
  const groups = new Map<string, string[]>()
  const diagnostics: WorkspaceDiagnostic[] = []
  const byFolded = new Map<string, string>()
  for (const path of paths) {
    const key = path.slice(KIND_DIRS.file.length + 1)
    const problem = filePathProblem(key)
    if (problem !== null) {
      diagnostics.push(
        pathFinding(
          'E_FILE_PATH',
          path,
          `${path} cannot be a workspace file: ${problem}.`,
          'Rename it, or move it out of files/.'
        )
      )
      continue
    }
    const other = byFolded.get(foldedFileKey(key))
    if (other !== undefined) {
      diagnostics.push(
        pathFinding(
          'E_FILE_PATH_COLLISION',
          path,
          other === key
            ? `${path} is listed twice.`
            : `${path} and ${fileBlobPath(other)} differ only in letter case.`,
          'Keep one of them: a case-insensitive disk holds them as one file.'
        )
      )
      continue
    }
    byFolded.set(foldedFileKey(key), key)
    groups.set(key, [path])
  }
  for (const key of [...groups.keys()]) {
    const segments = key.split('/')
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = byFolded.get(foldedFileKey(segments.slice(0, depth).join('/')))
      if (folder === undefined) continue
      diagnostics.push(
        pathFinding(
          'E_FILE_PATH_COLLISION',
          fileBlobPath(key),
          `${fileBlobPath(folder)} is a file, so it cannot also be a folder of ${fileBlobPath(key)}.`
        )
      )
      groups.delete(key)
      break
    }
  }
  if (groups.size > WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind) {
    diagnostics.push(
      diagnostic(
        'E_LIMIT_EXCEEDED',
        `files/ holds ${groups.size} files, over the ${WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind} limit.`,
        { kind: 'file' }
      )
    )
  }
  return { groups, diagnostics }
}

function parseFile(
  key: string,
  text: Readonly<Record<string, string>>,
  blobs: readonly BlobEntry[]
): { decl?: FileDecl; diagnostics: WorkspaceDiagnostic[] } {
  const path = fileBlobPath(key)
  const blob = blobs.find((entry) => entry.path === path)
  if (Object.hasOwn(text, path) || !blob) {
    return {
      diagnostics: [
        pathFinding(
          'E_FILE_CONTENT',
          path,
          `${path} was sent as text; a workspace file travels as a blob, by hash.`
        ),
      ],
    }
  }
  if (!SHA256.test(blob.sha256) || !Number.isSafeInteger(blob.size) || blob.size < 0) {
    return {
      diagnostics: [
        pathFinding('E_FILE_CONTENT', path, `${path} needs a SHA-256 hash and a byte size.`),
      ],
    }
  }
  if (blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytes) {
    return {
      diagnostics: [
        pathFinding(
          'E_FILE_TOO_LARGE',
          path,
          `${path} is ${blob.size} bytes, over the ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}-byte limit.`,
          'Upload it in the Files tab; source never writes a file this large.'
        ),
      ],
    }
  }
  return { decl: { sha256: blob.sha256, size: blob.size }, diagnostics: [] }
}

export const fileCodec: KindCodec<FileDecl> = {
  kind: 'file',
  dir: KIND_DIRS.file,
  group: groupFiles,
  parse: parseFile,
  print: (key, decl) => ({
    text: {},
    blobs: [{ path: fileBlobPath(key), sha256: decl.sha256, size: decl.size }],
  }),
  canonical: (decl): Json => ({ sha256: decl.sha256 }),
}
