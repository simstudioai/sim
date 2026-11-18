/**
 * Encodes one Redis argument as an Upstash REST path segment. A bare `.` or `..` is refused
 * because URL parsing resolves it (encoded or not) as a dot segment, which would shift the
 * remaining arguments into the command position (for example `HGET .. flushall` becoming
 * `FLUSHALL`).
 */
export function upstashPathSegment(value: string, name: string): string {
  if (value === '.' || value === '..') {
    throw new Error(`${name} cannot be "." or ".." in an Upstash REST request`)
  }
  return encodeURIComponent(value)
}

/** Formats an integer Redis argument for an Upstash REST path or query, refusing anything else. */
export function upstashInteger(value: unknown, name: string): string {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be an integer`)
  }
  return String(parsed)
}
