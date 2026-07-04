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

/**
 * Chat-scoped VFS namespaces: `uploads/` (user attachments) and `outputs/`
 * (agent-generated one-off files, write-once). Both are flat — the first
 * segment after the prefix is the file; anything deeper is ignored by readers.
 */
export type ChatScopedVfsNamespace = 'uploads' | 'outputs'

function stripPathPrefixNoise(path: string): string {
  return path.trim().replace(/^\/+/, '')
}

/** True when a path/name targets the chat-scoped `uploads/` namespace. */
export function isUploadsPath(path: string | null | undefined): boolean {
  return !!path && stripPathPrefixNoise(path).startsWith('uploads/')
}

/**
 * True when a path/name targets the chat-scoped `outputs/` namespace
 * (write-once, non-editable). Tolerates leading slashes/whitespace so the
 * test cannot be dodged by spelling variants — always call this on the RAW
 * caller-supplied path, before any `files/` prefixing or rewriting.
 */
export function isOutputsPath(path: string | null | undefined): boolean {
  return !!path && stripPathPrefixNoise(path).startsWith('outputs/')
}

/**
 * The file segment of a chat-scoped path: the first segment after the
 * namespace prefix, returned raw (still percent-encoded if the caller passed
 * an encoded path — the chat-file readers accept both spellings). Both
 * namespaces are flat, so trailing segments (e.g. a `/content` suffix added
 * out of habit) are ignored. Returns '' when the path is not in the namespace.
 */
export function chatScopedLeafSegment(path: string, namespace: ChatScopedVfsNamespace): string {
  const normalized = stripPathPrefixNoise(path)
  const prefix = `${namespace}/`
  if (!normalized.startsWith(prefix)) return ''
  return normalized.slice(prefix.length).split('/')[0] ?? ''
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
