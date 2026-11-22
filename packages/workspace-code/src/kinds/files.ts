/**
 * Workspace files: every file under `files/` is one workspace file, its key the path below
 * `files/` (folder path, then name). The bytes travel as a blob by SHA-256, so the declaration is
 * only the hash and size; a file's folders are its path's segments.
 *
 * A path is refused when no workspace file could hold it or when two paths would land on one file
 * on a case-insensitive disk, so a directory always round-trips through a get on any machine.
 */
import { utf8ByteLength } from '@sim/utils/paste'
import { hasSuspiciousCharacter, type Json } from '@sim/workflow-code'
import type { ResourceFingerprint } from '../base'
import {
  diagnostic,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticCode,
  wholeFile,
} from '../diagnostics'
import { fingerprintOf } from '../fingerprint'
import { type BlobEntry, isWellFormedBlob, KIND_DIRS, type KindCodec } from '../kind'
import { isFileKey } from '../layout'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'

/** A workspace file under `files/`, by content hash. */
export interface FileDecl {
  /** Lowercase hex SHA-256 of the bytes. */
  sha256: string
  size: number
}

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
    if (utf8ByteLength(segment) > MAX_SEGMENT_BYTES) {
      return `"${segment.slice(0, 32)}…" is over ${MAX_SEGMENT_BYTES} bytes`
    }
  }
  return isFileKey(key) ? null : 'the path holds a control or reserved character'
}

/** The spelling two paths share when a case-insensitive disk would store them as one. */
export function foldedFileKey(key: string): string {
  return key.normalize('NFC').toLowerCase()
}

/**
 * Among distinct keys, the ones no directory can hold beside the keys before them, each with why:
 * a file or folder that differs only in letter case from an earlier one (a case-insensitive disk
 * holds them as one), or a name that is a file in one key and a folder in another. The earlier key
 * keeps its path, so the same keys in the same order always keep the same files.
 */
export function fileKeyConflicts(keys: Iterable<string>): Map<string, string> {
  const root: PathNode = { spelling: '', children: new Map() }
  const conflicts = new Map<string, string>()
  for (const key of keys) {
    const conflict = keyConflict(key, root)
    if (conflict !== null) conflicts.set(key, conflict)
    else insertKey(key, root)
  }
  return conflicts
}

/**
 * The paths kept so far as a tree of folded segments: each node keeps the spelling of the key
 * that made it, and a file node the key it holds. Every key costs one fold of each of its
 * segments, and the tree holds each segment once.
 */
interface PathNode {
  spelling: string
  file?: string
  children: Map<string, PathNode>
}

function keyConflict(key: string, root: PathNode): string | null {
  const segments = key.split('/')
  const folders: Array<{ prefix: string; stored: string; node: PathNode }> = []
  let node = root
  let prefix = ''
  let stored = ''
  for (const [index, segment] of segments.entries()) {
    const child = node.children.get(foldedFileKey(segment))
    if (child === undefined) break
    const separator = index === 0 ? '' : '/'
    prefix += separator + segment
    stored += separator + child.spelling
    if (index === segments.length - 1) {
      if (child.file !== undefined) {
        return `${fileBlobPath(key)} and ${fileBlobPath(child.file)} differ only in letter case`
      }
      return `${fileBlobPath(stored)} is a folder, so ${fileBlobPath(key)} cannot also be a file`
    }
    folders.push({ prefix, stored, node: child })
    node = child
  }
  for (const folder of folders) {
    if (folder.node.file !== undefined) {
      return `${fileBlobPath(folder.node.file)} is a file, so it cannot also be a folder of ${fileBlobPath(key)}`
    }
    if (folder.stored !== folder.prefix) {
      return `the folder ${fileBlobPath(folder.prefix)} differs only in letter case from ${fileBlobPath(folder.stored)}`
    }
  }
  return null
}

function insertKey(key: string, root: PathNode): void {
  let node = root
  for (const segment of key.split('/')) {
    const folded = foldedFileKey(segment)
    let child = node.children.get(folded)
    if (child === undefined) {
      child = { spelling: segment, children: new Map() }
      node.children.set(folded, child)
    }
    node = child
  }
  node.file = key
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
    span: wholeFile(path),
    ...(hint ? { hint } : {}),
  })
}

function groupFiles(paths: readonly string[]) {
  const groups = new Map<string, string[]>()
  const diagnostics: WorkspaceDiagnostic[] = []
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
    if (groups.has(key)) {
      diagnostics.push(pathFinding('E_FILE_PATH_COLLISION', path, `${path} is listed twice.`))
      continue
    }
    if (hasSuspiciousCharacter(key)) {
      diagnostics.push(
        pathFinding(
          'W_DECL_SUSPICIOUS_CHARACTER',
          path,
          `${path} holds an invisible bidi control or zero-width character, so it reads differently from its name.`,
          'Rename it so the path shows every character it holds.'
        )
      )
    }
    groups.set(key, [path])
  }
  for (const [key, conflict] of fileKeyConflicts(groups.keys())) {
    diagnostics.push(
      pathFinding(
        'E_FILE_PATH_COLLISION',
        fileBlobPath(key),
        `${conflict}.`,
        'Keep one of them: a case-insensitive disk holds them as one.'
      )
    )
    groups.delete(key)
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
  if (!isWellFormedBlob(blob)) {
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

/** A file's canonical form: its bytes, by hash (its size and name are not part of it). */
function fileCanonical(sha256: string): Json {
  return { sha256 }
}

/** The fingerprint of a file whose bytes hash to `sha256`, as its codec computes it. */
export function fileFingerprint(sha256: string): ResourceFingerprint {
  return fingerprintOf(fileCanonical(sha256))
}

/** Reads and prints `files/**`. */
export const fileCodec: KindCodec<FileDecl> = {
  isBlob: () => true,
  group: groupFiles,
  parse: parseFile,
  print: (key, decl) => ({
    text: {},
    blobs: [{ path: fileBlobPath(key), sha256: decl.sha256, size: decl.size }],
  }),
  canonical: (decl): Json => fileCanonical(decl.sha256),
}
