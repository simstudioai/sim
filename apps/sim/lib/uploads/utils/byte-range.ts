/**
 * HTTP `Range` parsing for byte-serving media.
 *
 * Pure and provider-agnostic: the storage layer turns a {@link ByteRange} into a
 * provider range read, and the serve routes turn one into a `206` response.
 *
 * Every offset returned is already clamped to the object's real size, which is
 * the property the anonymous share routes depend on — a caller cannot use a
 * crafted `Range` to read past an object or to learn anything about one it was
 * not granted.
 */

/** An inclusive byte interval, as HTTP defines it: `bytes=start-end` covers both ends. */
export interface ByteRange {
  readonly start: number
  readonly end: number
}

/**
 * `null` — no (or unusable) range header, serve the whole object.
 * `'unsatisfiable'` — a syntactically valid range that starts past the object,
 * which HTTP requires be answered with `416`, not with the whole body.
 */
export type ParsedByteRange = ByteRange | null | 'unsatisfiable'

/** `bytes=<first>-<last>` / `bytes=<first>-` / `bytes=-<suffix>`, single range only. */
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/

/**
 * Parses a `Range` header against an object of `size` bytes.
 *
 * Deliberately single-range: multi-range responses require a `multipart/byteranges`
 * body that no media element asks for, and every additional accepted shape is
 * more surface on routes an anonymous visitor can reach. A multi-range header is
 * treated as absent, which HTTP explicitly permits — a server MAY ignore a
 * `Range` it does not support and return the whole representation.
 *
 * A malformed header is ignored rather than rejected, for the same reason.
 */
export function parseByteRange(header: string | null | undefined, size: number): ParsedByteRange {
  if (!header || !Number.isFinite(size) || size <= 0) return null

  const match = RANGE_PATTERN.exec(header.trim())
  if (!match) return null

  const [, firstRaw, lastRaw] = match

  /** `bytes=-N` — the final N bytes. `bytes=-0` is unsatisfiable by definition. */
  if (firstRaw === '') {
    if (lastRaw === '') return null
    const suffix = Number(lastRaw)
    if (!Number.isSafeInteger(suffix)) return null
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(firstRaw)
  if (!Number.isSafeInteger(start)) return null
  if (start >= size) return 'unsatisfiable'

  if (lastRaw === '') return { start, end: size - 1 }

  const last = Number(lastRaw)
  if (!Number.isSafeInteger(last)) return null
  if (last < start) return null

  /** Clamped, so an over-long end reads to the object's end instead of past it. */
  return { start, end: Math.min(last, size - 1) }
}

/** The `Content-Range` value for a satisfied range. */
export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`
}

/** The `Content-Range` value for a `416`, which must report the object's size. */
export function unsatisfiableContentRangeHeader(size: number): string {
  return `bytes */${size}`
}

/** How many bytes a range covers. */
export function byteRangeLength(range: ByteRange): number {
  return range.end - range.start + 1
}

/**
 * Whether a content type is audio or video.
 *
 * One predicate for the two decisions media drives, because they are the same
 * question asked twice. It is byte-served rather than buffered — media is the
 * only thing a browser seeks within, and the only thing large enough that
 * buffering costs real memory — and it is served `inline` rather than as an
 * attachment, because a media element is a passive decoder with nothing to
 * execute. Everything else keeps the buffered path, which is what the
 * generated-document swap and the download audit are written against.
 */
export function isMediaContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  const normalized = contentType.toLowerCase()
  return normalized.startsWith('audio/') || normalized.startsWith('video/')
}
