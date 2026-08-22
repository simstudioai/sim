import type { folder } from '@sim/db/schema'
import { containsNulCharacter } from '@sim/utils/string'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const ROOT_FOLDER_PATH = '/'
export const MAX_FOLDER_PATH_SEGMENTS = 64
export const MAX_FOLDER_PATH_BYTES = 4096

type FolderPathRow = Pick<typeof folder.$inferSelect, 'id' | 'name' | 'parentId'>

/**
 * A malformed or non-canonical folder path supplied by a caller — an empty
 * segment, invalid Unicode, an over-long path, or a mutation of the root.
 * Classified `validation` so it surfaces as a 400 rather than a 500.
 *
 * Reserved for parsing caller input. A fault discovered while building the
 * index from stored rows is {@link FolderHierarchyError}, not this.
 */
export class FolderPathError extends OrchestrationError {
  constructor(message: string) {
    super('validation', message)
    this.name = 'FolderPathError'
  }
}

/**
 * A stored folder tree that violates its own invariants — a duplicate id or
 * path, a cycle, or a missing parent. Nothing the caller sends can cause or fix
 * it, so it stays a 500: reporting corruption as a 400 would both misdirect the
 * caller and drop a real incident out of 5xx alerting. `internal` also keeps the
 * diagnostic message off the wire.
 */
export class FolderHierarchyError extends OrchestrationError {
  constructor(message: string) {
    super('internal', message)
    this.name = 'FolderHierarchyError'
  }
}

export interface FolderPathIndex<Row extends FolderPathRow = FolderPathRow> {
  rowById: ReadonlyMap<string, Row>
  pathById: ReadonlyMap<string, string>
  idByPath: ReadonlyMap<string, string>
}

export interface FolderPathView {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Encodes one stored folder name without normalizing its case or Unicode form.
 *
 * This is the single chokepoint for what a folder name may contain: every path
 * built from names passes through it, and {@link parseFolderPath} re-encodes
 * each decoded segment through it to prove canonicality. So the NUL rejection
 * belongs here rather than at either caller.
 *
 * The request-level scan in `@/lib/api/server/nul-bytes` cannot cover this. A
 * folder path arrives percent-encoded, so the scan sees `%00` — three ordinary
 * characters — and passes it, and the NUL only exists after this module decodes
 * it. Reads happened to survive (an unmatched path is a 404); writers carried
 * the decoded name into an `INSERT` and the driver threw a 500. Validating at
 * the decode boundary covers every percent-encoded escape a caller can spell,
 * not just the one that was reported.
 */
export function encodeFolderPathSegment(name: string): string {
  if (name.length === 0) throw new FolderPathError('Folder names cannot be empty')
  if (containsNulCharacter(name)) {
    throw new FolderPathError('Folder names cannot contain a NUL character (U+0000)')
  }

  if (name === '.') return '%2E'
  if (name === '..') return '%2E%2E'

  try {
    return encodeURIComponent(name).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
  } catch {
    throw new FolderPathError('Folder name contains invalid Unicode')
  }
}

/** Builds the canonical public path for a decoded sequence of folder names. */
export function buildFolderPath(segments: readonly string[]): string {
  if (segments.length === 0) return ROOT_FOLDER_PATH
  if (segments.length > MAX_FOLDER_PATH_SEGMENTS) {
    throw new FolderPathError(`Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`)
  }

  const path = `/${segments.map(encodeFolderPathSegment).join('/')}`
  if (encodedByteLength(path) > MAX_FOLDER_PATH_BYTES) {
    throw new FolderPathError(`Folder paths cannot exceed ${MAX_FOLDER_PATH_BYTES} bytes`)
  }
  return path
}

/**
 * Parses a canonical public folder path. Accepted paths are byte-for-byte canonical: callers
 * cannot use alternate escapes, raw reserved characters, or normalization aliases.
 */
export function parseFolderPath(path: string): string[] {
  if (path === ROOT_FOLDER_PATH) return []
  if (!path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    throw new FolderPathError('Path must be a canonical folder path')
  }
  if (encodedByteLength(path) > MAX_FOLDER_PATH_BYTES) {
    throw new FolderPathError(`Folder paths cannot exceed ${MAX_FOLDER_PATH_BYTES} bytes`)
  }

  const encodedSegments = path.slice(1).split('/')
  if (encodedSegments.length > MAX_FOLDER_PATH_SEGMENTS) {
    throw new FolderPathError(`Folder paths cannot exceed ${MAX_FOLDER_PATH_SEGMENTS} segments`)
  }

  return encodedSegments.map((encodedSegment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(encodedSegment)
    } catch {
      throw new FolderPathError('Path must be a canonical folder path')
    }

    if (encodeFolderPathSegment(decoded) !== encodedSegment) {
      throw new FolderPathError('Path must be a canonical folder path')
    }
    return decoded
  })
}

export function requireNonRootFolderPath(path: string): string[] {
  const segments = parseFolderPath(path)
  if (segments.length === 0) throw new FolderPathError('The root path cannot be mutated')
  return segments
}

export function parentFolderPath(path: string): string {
  const segments = requireNonRootFolderPath(path)
  return buildFolderPath(segments.slice(0, -1))
}

export function folderNameFromPath(path: string): string {
  const segments = requireNonRootFolderPath(path)
  return segments[segments.length - 1]
}

/**
 * Runs a path helper over STORED rows. Those helpers classify their failures as
 * caller input, which is wrong here — the caller supplied nothing. Rethrowing as
 * a hierarchy fault keeps corruption a 500 and out of the client's face.
 */
function overStoredRows<T>(read: () => T): T {
  try {
    return read()
  } catch (error) {
    if (error instanceof FolderPathError) throw new FolderHierarchyError(error.message)
    throw error
  }
}

/** Builds a lossless, fail-fast bidirectional index over one active resource folder tree. */
export function buildFolderPathIndex<Row extends FolderPathRow>(
  rows: readonly Row[]
): FolderPathIndex<Row> {
  const rowById = new Map<string, Row>()
  for (const row of rows) {
    if (rowById.has(row.id)) throw new FolderHierarchyError(`Duplicate folder id: ${row.id}`)
    rowById.set(row.id, row)
  }

  const pathById = new Map<string, string>()
  const idByPath = new Map<string, string>()
  const visiting = new Set<string>()

  const resolvePath = (folderId: string): string => {
    const resolved = pathById.get(folderId)
    if (resolved) return resolved
    if (visiting.has(folderId)) throw new FolderHierarchyError('Folder hierarchy contains a cycle')

    const row = rowById.get(folderId)
    if (!row)
      throw new FolderHierarchyError(`Folder hierarchy references missing folder: ${folderId}`)

    visiting.add(folderId)
    const parentPath = row.parentId ? resolvePath(row.parentId) : ROOT_FOLDER_PATH
    const path = overStoredRows(() =>
      parentPath === ROOT_FOLDER_PATH
        ? `/${encodeFolderPathSegment(row.name)}`
        : `${parentPath}/${encodeFolderPathSegment(row.name)}`
    )
    visiting.delete(folderId)

    overStoredRows(() => parseFolderPath(path))
    const duplicateId = idByPath.get(path)
    if (duplicateId && duplicateId !== folderId) {
      throw new FolderHierarchyError(`Folder hierarchy contains duplicate path: ${path}`)
    }
    pathById.set(folderId, path)
    idByPath.set(path, folderId)
    return path
  }

  for (const row of rows) resolvePath(row.id)

  return { rowById, pathById, idByPath }
}

export function toFolderPathView(
  row: Pick<typeof folder.$inferSelect, 'name' | 'createdAt' | 'updatedAt'>,
  path: string
): FolderPathView {
  return {
    name: row.name,
    path,
    parentPath: parentFolderPath(path),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function isFolderPathEffectivelyLocked(
  index: FolderPathIndex<FolderPathRow & { locked: boolean }>,
  folderId: string
): boolean {
  let currentId: string | null = folderId
  while (currentId) {
    const row = index.rowById.get(currentId)
    if (!row) throw new FolderHierarchyError('Folder hierarchy references a missing ancestor')
    if (row.locked) return true
    currentId = row.parentId
  }
  return false
}
