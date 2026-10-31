import { escapeRegExp, WHITESPACE_CHARACTER_CLASS } from '@sim/utils/string'

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const WHITESPACE = new RegExp(`${WHITESPACE_CHARACTER_CLASS}+`, 'g')

export class VfsPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VfsPathError'
  }
}

/** A `files/…` workspace-file VFS path. File ids are drawn from `[A-Za-z0-9_-]`, so no id is one. */
export function isWorkspaceFileVfsPath(reference: string): boolean {
  return reference.startsWith('files/')
}

/**
 * The name a VFS path segment displays: NFC-composed, trimmed, control characters removed,
 * whitespace runs collapsed. Its SQL twin is `displaySegmentKey` in `@sim/db/schema`, which an
 * index serves; the two must apply the same steps in the same order.
 */
export function normalizeDisplaySegment(segment: string): string {
  return segment.normalize('NFC').trim().replace(CONTROL_CHARS, '').replace(WHITESPACE, ' ')
}

/**
 * Anchored regular expression, valid in JavaScript and PostgreSQL, that matches every
 * NFC-composed, control-character-free name whose segment decodes to `name`: the words of
 * `name` (already in decoded form) separated by whitespace runs, with any whitespace around them.
 */
export function displaySegmentPattern(name: string): string {
  const words = name.split(' ').map(escapeRegExp)
  return `^${WHITESPACE_CHARACTER_CLASS}*${words.join(`${WHITESPACE_CHARACTER_CLASS}+`)}${WHITESPACE_CHARACTER_CLASS}*$`
}

export function encodeVfsSegment(segment: string): string {
  const normalized = normalizeDisplaySegment(segment)
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new VfsPathError('VFS path segment cannot be empty or a dot segment')
  }
  return encodeURIComponent(normalized)
}

function decodeVfsSegment(segment: string, options?: { literalOnBadEncoding?: boolean }): string {
  try {
    const decoded = decodeLiteralOnBadEncoding(segment, options?.literalOnBadEncoding)
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

function decodeLiteralOnBadEncoding(segment: string, literal: boolean | undefined): string {
  try {
    return decodeURIComponent(segment)
  } catch (error) {
    if (literal) return segment
    throw error
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
  return trimmed.split('/').map((segment) => decodeVfsSegment(segment))
}

/**
 * {@link decodeVfsPathSegments} for a file reference, which may be a bare name rather than an
 * encoded path: a segment that is not valid percent-encoding (`100%_done.txt`) is read
 * literally. Empty and dot segments still throw.
 */
export function decodeVfsReferenceSegments(path: string): string[] {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return []
  return trimmed
    .split('/')
    .map((segment) => decodeVfsSegment(segment, { literalOnBadEncoding: true }))
}
