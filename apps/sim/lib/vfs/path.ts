import { escapeRegExp, WHITESPACE_CHARACTER_CLASS } from '@sim/utils/string'

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const WHITESPACE = new RegExp(`${WHITESPACE_CHARACTER_CLASS}+`, 'g')

export class VfsPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VfsPathError'
  }
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

function decodeVfsSegment(segment: string): string {
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
