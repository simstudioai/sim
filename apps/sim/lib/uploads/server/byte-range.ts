import type { ByteRange } from '@/lib/uploads/shared/types'

/**
 * What to send for a request's `Range`, per RFC 9110 §14.
 *
 * - `full` — the whole representation, as a 200. Also the answer to every header this declines to
 *   honor: a server may always ignore `Range`, so malformed and multi-range requests degrade to it.
 * - `partial` — the one span asked for, as a 206.
 * - `unsatisfiable` — a well-formed range that selects no byte, as a 416.
 */
type ByteRangeResolution =
  | { kind: 'full' }
  | { kind: 'partial'; range: ByteRange }
  | { kind: 'unsatisfiable' }

const FULL: ByteRangeResolution = { kind: 'full' }
const UNSATISFIABLE: ByteRangeResolution = { kind: 'unsatisfiable' }

const RANGE_SPEC = /^(\d*)-(\d*)$/

/** An omitted offset reads as `undefined`; one too large to represent exactly is not an offset. */
function isOffset(value: number | undefined): boolean {
  return value === undefined || Number.isSafeInteger(value)
}

/**
 * Whether `If-Range` still names the bytes being served, so parts the client already holds can be
 * completed rather than restarted. Only a strong entity-tag qualifies (RFC 9110 §13.1.5): a weak one
 * cannot vouch for byte-identical parts, and the date form is never matched because no
 * `Last-Modified` is issued.
 */
function ifRangeHolds(ifRange: string | null, etag: string | undefined): boolean {
  if (ifRange === null) return true
  return etag !== undefined && ifRange.trim() === etag
}

/**
 * Resolves a request's `Range` against a representation of `size` bytes.
 *
 * One span is served at most. A multi-range request is answered whole instead of as a
 * `multipart/byteranges` body: media players and download managers ask for one span at a time, and
 * the standard permits ignoring `Range` outright. An empty representation is likewise sent whole,
 * because no range of it can exist.
 */
export function resolveByteRange(input: {
  range: string | null
  ifRange: string | null
  etag: string | undefined
  size: number
}): ByteRangeResolution {
  const { range, size } = input
  if (!range || size <= 0) return FULL
  if (!ifRangeHolds(input.ifRange, input.etag)) return FULL

  const separator = range.indexOf('=')
  if (separator === -1 || range.slice(0, separator).trim().toLowerCase() !== 'bytes') return FULL

  const specs = range.slice(separator + 1).split(',')
  if (specs.length !== 1) return FULL
  const match = RANGE_SPEC.exec(specs[0].trim())
  if (!match) return FULL

  const first = match[1] ? Number(match[1]) : undefined
  const last = match[2] ? Number(match[2]) : undefined
  if (!isOffset(first) || !isOffset(last)) return FULL

  if (first === undefined) {
    if (last === undefined) return FULL
    if (last === 0) return UNSATISFIABLE
    return { kind: 'partial', range: { start: Math.max(0, size - last), end: size - 1 } }
  }

  if (last !== undefined && last < first) return FULL
  if (first >= size) return UNSATISFIABLE
  return {
    kind: 'partial',
    range: { start: first, end: last === undefined ? size - 1 : Math.min(last, size - 1) },
  }
}
