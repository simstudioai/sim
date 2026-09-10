/**
 * A bare `[\uD800-\uDFFF]` class would match both halves of a *valid* pair,
 * deleting every non-BMP character rather than only the malformed ones.
 */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Strips control characters, replacement characters, and unpaired surrogates so
 * the text is safe for UTF-8 storage in PostgreSQL. Tabs, newlines, and carriage
 * returns are preserved.
 */
export function sanitizeTextForUTF8(text: string): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(UNPAIRED_SURROGATE, '')
}

/** Formats the inline `[... detail ...]` marker parsers append when a limit stopped extraction early. */
export function truncationNotice(detail: string): string {
  return `\n[... ${detail} ...]\n`
}

/** Character encodings {@link decodeTextBuffer} can produce. */
export type TextEncodingLabel = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export interface DecodedText {
  text: string
  encoding: TextEncodingLabel
  /** Set when the bytes were not clean UTF-8 and a lossy or inferred decode was used. */
  warning?: string
}

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true })
const utf16leDecoder = new TextDecoder('utf-16le')
const utf16beDecoder = new TextDecoder('utf-16be')

/**
 * WHATWG windows-1252: identical to Latin-1 except 0x80–0x9F, which hold the
 * typographic characters (smart quotes, dashes, €, …) instead of C1 controls.
 * Implemented here rather than via `TextDecoder('windows-1252')` because a
 * Node build without full ICU silently falls back to Latin-1 for that label,
 * so the same bytes would decode differently under test and in production.
 */
const WINDOWS_1252_C1 = [
  '\u20AC',
  '\u0081',
  '\u201A',
  '\u0192',
  '\u201E',
  '\u2026',
  '\u2020',
  '\u2021',
  '\u02C6',
  '\u2030',
  '\u0160',
  '\u2039',
  '\u0152',
  '\u008D',
  '\u017D',
  '\u008F',
  '\u0090',
  '\u2018',
  '\u2019',
  '\u201C',
  '\u201D',
  '\u2022',
  '\u2013',
  '\u2014',
  '\u02DC',
  '\u2122',
  '\u0161',
  '\u203A',
  '\u0153',
  '\u009D',
  '\u017E',
  '\u0178',
] as const
/** Every byte value's windows-1252 code point; all of them are BMP, so one UTF-16 code unit each. */
const WINDOWS_1252_CODE_UNITS = Uint16Array.from({ length: 256 }, (_, byte) =>
  byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_C1[byte - 0x80].charCodeAt(0) : byte
)
const WINDOWS_1252_SELF_TEST_BYTES = new Uint8Array([0x80, 0x93, 0x94, 0x9f, 0xe9])
const WINDOWS_1252_SELF_TEST_TEXT = '\u20AC\u201C\u201D\u0178\u00E9'
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/**
 * `TextDecoder('windows-1252')` when the runtime really implements it (checked
 * once here — Bun 1.3 does; a Node build without full ICU accepts the label but
 * decodes as Latin-1), otherwise the table decoder below.
 */
const nativeWindows1252Decoder = (() => {
  try {
    const decoder = new TextDecoder('windows-1252')
    return decoder.encoding === 'windows-1252' &&
      decoder.decode(WINDOWS_1252_SELF_TEST_BYTES) === WINDOWS_1252_SELF_TEST_TEXT
      ? decoder
      : null
  } catch {
    return null
  }
})()

/**
 * One pass mapping each byte to its UTF-16 code unit, then a single native
 * UTF-16 decode. Peak transient memory is the 2-byte-per-input code-unit array;
 * the earlier `toString('latin1')` + regex replace materialized several string
 * copies and, on 100 MB of C1 bytes, took seconds and gigabytes.
 */
export function decodeWindows1252WithTable(buffer: Uint8Array): string {
  const units = new Uint16Array(buffer.length)
  for (let index = 0; index < buffer.length; index++) {
    units[index] = WINDOWS_1252_CODE_UNITS[buffer[index]]
  }
  if (HOST_IS_LITTLE_ENDIAN) return utf16leDecoder.decode(units)
  return utf16beDecoder.decode(units)
}

export function decodeWindows1252(buffer: Uint8Array): string {
  return nativeWindows1252Decoder
    ? nativeWindows1252Decoder.decode(buffer)
    : decodeWindows1252WithTable(buffer)
}

const UTF8_BOM_LENGTH = 3
const UTF16_BOM_LENGTH = 2
/** A UTF-8 sequence is at most four bytes, so a truncated tail is at most three. */
const MAX_TRUNCATED_UTF8_TAIL = 3
const UTF16_HEURISTIC_SAMPLE_BYTES = 4096

export const TRUNCATED_UTF8_WARNING = 'Trailing bytes of an incomplete UTF-8 sequence were dropped'
export const WINDOWS_1252_WARNING =
  'File was not valid UTF-8; decoded as Windows-1252; the file may use another encoding'

function stripLeadingBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Declared length of the UTF-8 sequence a lead byte starts, or 0 for a non-lead byte. */
function utf8SequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2
  if (lead >= 0xe0 && lead <= 0xef) return 3
  if (lead >= 0xf0 && lead <= 0xf4) return 4
  return 0
}

/**
 * Whether the last `tailLength` bytes look like the cut-off start of one UTF-8
 * sequence (a lead byte followed only by continuation bytes, shorter than the
 * length the lead declares) AND the bytes before it already contain multi-byte
 * UTF-8. Without that second condition a Latin-1 file that merely ends in an
 * accented letter would be misread as truncated UTF-8 and lose the letter.
 */
function isTruncatedUtf8Tail(buffer: Uint8Array, tailLength: number): boolean {
  const tailStart = buffer.length - tailLength
  const declared = utf8SequenceLength(buffer[tailStart])
  if (declared === 0 || tailLength >= declared) return false
  for (let index = tailStart + 1; index < buffer.length; index++) {
    if ((buffer[index] & 0xc0) !== 0x80) return false
  }
  for (let index = 0; index < tailStart; index++) {
    if (buffer[index] >= 0x80) return true
  }
  return false
}

/**
 * Whether a BOM-less buffer is laid out as UTF-16 ASCII-range text: one half of
 * every byte pair is NUL while the other is not. Reports the byte order of the
 * non-NUL half, or `null` when the sample does not fit either layout.
 */
export function detectBomlessUtf16(buffer: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sampleLength = Math.min(buffer.length, UTF16_HEURISTIC_SAMPLE_BYTES) & ~1
  if (sampleLength < 4) return null

  let evenNul = 0
  let oddNul = 0
  for (let index = 0; index < sampleLength; index += 2) {
    if (buffer[index] === 0) evenNul++
    if (buffer[index + 1] === 0) oddNul++
  }

  const pairs = sampleLength / 2
  const highThreshold = pairs * 0.9
  const lowThreshold = pairs * 0.05
  if (oddNul >= highThreshold && evenNul <= lowThreshold) return 'utf-16le'
  if (evenNul >= highThreshold && oddNul <= lowThreshold) return 'utf-16be'
  return null
}

/**
 * Decodes text bytes without ever emitting U+FFFD for single-byte input.
 *
 * Order: a UTF-16 BOM wins; otherwise strict UTF-8 (which also consumes a UTF-8
 * BOM). When strict UTF-8 rejects the buffer it is retried with up to three
 * trailing bytes removed, so a size-capped download cut mid-codepoint keeps its
 * UTF-8 reading instead of falling to Windows-1252 wholesale. Only then is the
 * whole buffer read as Windows-1252, which is a superset of Latin-1 and decodes
 * every byte, so `sanitizeTextForUTF8` has nothing to delete. Never throws.
 */
export function decodeTextBuffer(buffer: Uint8Array): DecodedText {
  if (buffer.length >= UTF16_BOM_LENGTH) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return {
        text: stripLeadingBom(utf16leDecoder.decode(buffer.subarray(UTF16_BOM_LENGTH))),
        encoding: 'utf-16le',
      }
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return {
        text: stripLeadingBom(utf16beDecoder.decode(buffer.subarray(UTF16_BOM_LENGTH))),
        encoding: 'utf-16be',
      }
    }
  }

  const bomlessUtf16 = detectBomlessUtf16(buffer)
  if (bomlessUtf16 === 'utf-16le') {
    return { text: utf16leDecoder.decode(buffer), encoding: 'utf-16le' }
  }
  if (bomlessUtf16 === 'utf-16be') {
    return { text: utf16beDecoder.decode(buffer), encoding: 'utf-16be' }
  }

  try {
    return { text: strictUtf8Decoder.decode(buffer), encoding: 'utf-8' }
  } catch {
    for (let dropped = 1; dropped <= MAX_TRUNCATED_UTF8_TAIL; dropped++) {
      if (buffer.length - dropped < UTF8_BOM_LENGTH) break
      if (!isTruncatedUtf8Tail(buffer, dropped)) continue
      try {
        return {
          text: strictUtf8Decoder.decode(buffer.subarray(0, buffer.length - dropped)),
          encoding: 'utf-8',
          warning: TRUNCATED_UTF8_WARNING,
        }
      } catch {}
    }
  }

  return {
    text: decodeWindows1252(buffer),
    encoding: 'windows-1252',
    warning: WINDOWS_1252_WARNING,
  }
}
