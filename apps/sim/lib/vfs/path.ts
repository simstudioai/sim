import { escapeRegExp } from '@sim/utils/string'

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
/** The characters `\s` matches, spelled out so a PostgreSQL pattern can share the class. */
const WHITESPACE_CLASS =
  '[ \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'
const WHITESPACE = new RegExp(`${WHITESPACE_CLASS}+`, 'g')

export class VfsPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VfsPathError'
  }
}

function normalizeDisplaySegment(segment: string): string {
  return segment.normalize('NFC').trim().replace(CONTROL_CHARS, '').replace(WHITESPACE, ' ')
}

/**
 * Anchored regular expression, valid in JavaScript and PostgreSQL, that matches every
 * NFC-composed, control-character-free name whose segment decodes to `name`: the words of
 * `name` (already in decoded form) separated by whitespace runs, with any whitespace around them.
 */
export function displaySegmentPattern(name: string): string {
  const words = name.split(' ').map(escapeRegExp)
  return `^${WHITESPACE_CLASS}*${words.join(`${WHITESPACE_CLASS}+`)}${WHITESPACE_CLASS}*$`
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
