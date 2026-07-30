const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const WHITESPACE = /\s+/g

export class VfsPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VfsPathError'
  }
}

function normalizeDisplaySegment(segment: string): string {
  return segment.normalize('NFC').trim().replace(CONTROL_CHARS, '').replace(WHITESPACE, ' ')
}

export function encodeVfsSegment(segment: string): string {
  const normalized = normalizeDisplaySegment(segment)
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new VfsPathError('VFS path segment cannot be empty or a dot segment')
  }
  return encodeURIComponent(normalized)
}

export function decodeVfsSegment(segment: string): string {
  try {
    const decoded = decodeURIComponent(segment)
    const normalized = normalizeDisplaySegment(decoded)
    if (!normalized || normalized === '.' || normalized === '..') {
      throw new VfsPathError('VFS path segment cannot be empty or a dot segment')
    }
    return normalized
  } catch (error) {
    if (error instanceof VfsPathError) throw error
    throw new VfsPathError(`Invalid encoded VFS path segment: ${segment}`)
  }
}

/**
 * Decodes a VFS path segment for display, falling back to the raw segment when
 * it is not valid encoding (e.g. a literal "%" that was never encoded).
 */
export function decodeVfsSegmentSafe(segment: string): string {
  try {
    return decodeVfsSegment(segment)
  } catch {
    return segment
  }
}

export function encodeVfsPathSegments(segments: string[]): string {
  return segments.map(encodeVfsSegment).join('/')
}

export function decodeVfsPathSegments(path: string): string[] {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return []
  return trimmed.split('/').map(decodeVfsSegment)
}

export function canonicalizeVfsPath(path: string): string {
  return encodeVfsPathSegments(decodeVfsPathSegments(path))
}

export function canonicalWorkspaceFilePath(parts: {
  folderPath?: string | null
  name: string
  prefix?: 'files' | 'recently-deleted/files'
}): string {
  const prefix = parts.prefix ?? 'files'
  const folderSegments = parts.folderPath ? parts.folderPath.split('/').filter(Boolean) : []
  const encoded = encodeVfsPathSegments([...folderSegments, parts.name])
  return `${prefix}/${encoded}`
}

/**
 * Build a map from folderId to its canonical, per-segment-encoded VFS folder
 * path (e.g. `My%20Folder/Sub`), resolving nested folders via `parentId`.
 *
 * Shared by the workspace VFS materializer (`workspace-vfs.ts`) and the chat
 * context resolver (`process-contents.ts`) so workflow/folder pointer paths
 * cannot drift from what the VFS actually serves. Works for any folder
 * hierarchy that exposes `{ folderId, folderName, parentId }` rows (workflow
 * folders and file folders both qualify).
 */
export function buildVfsFolderPathMap(
  folders: Array<{ folderId: string; folderName: string; parentId: string | null }>
): Map<string, string> {
  const folderMap = new Map<string, { name: string; parentId: string | null }>()
  for (const f of folders) {
    folderMap.set(f.folderId, { name: f.folderName, parentId: f.parentId })
  }

  const cache = new Map<string, string>()
  const resolve = (id: string): string => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    const folder = folderMap.get(id)
    if (!folder) return ''
    const parentPath = folder.parentId ? resolve(folder.parentId) : ''
    const path = parentPath
      ? `${parentPath}/${encodeVfsSegment(folder.name)}`
      : encodeVfsSegment(folder.name)
    cache.set(id, path)
    return path
  }

  for (const id of folderMap.keys()) resolve(id)
  return cache
}

/**
 * Canonical VFS directory for a workflow. `folderPath` is the already
 * per-segment-encoded folder path (from {@link buildVfsFolderPathMap}) or
 * null/empty for a root-level workflow. Mirrors the prefix built by
 * `workspace-vfs.ts` (`workflows/{folder}/{name}` or `workflows/{name}`).
 */
export function canonicalWorkflowVfsDir(parts: {
  name: string
  folderPath?: string | null
}): string {
  const safeName = encodeVfsSegment(parts.name)
  return parts.folderPath ? `workflows/${parts.folderPath}/${safeName}` : `workflows/${safeName}`
}

/** Canonical VFS path for a table's metadata file (`tables/{name}/meta.json`). */
export function canonicalTableVfsPath(name: string): string {
  return `tables/${encodeVfsSegment(name)}/meta.json`
}

/** Canonical VFS directory for a knowledge base (`knowledgebases/{name}`). */
export function canonicalKnowledgeBaseVfsDir(name: string): string {
  return `knowledgebases/${encodeVfsSegment(name)}`
}

/** Canonical VFS path for a block catalog entry (`components/blocks/{type}.json`). */
export function canonicalBlockVfsPath(blockType: string): string {
  return `components/blocks/${blockType}.json`
}
