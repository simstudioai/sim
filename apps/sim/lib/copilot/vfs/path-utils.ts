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
