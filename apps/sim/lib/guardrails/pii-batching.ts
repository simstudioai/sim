/**
 * Per-request bounds shared by both Presidio hops: the app→route HTTP call
 * (`mask-client`) and the route→service call (`validate-pii`). Keeping a single
 * source of truth ensures every request stays far under the 10MB Next body limit,
 * every text fits one spaCy NER pass, and each request is one short pass.
 */

/** Max UTF-8 bytes of text per Presidio request. ~40× under the 10MB Next limit. */
export const PII_REQUEST_MAX_BYTES = 256 * 1024
/** Max strings per request; caps per-item overhead and stays well under the contract's 100k-entry cap. */
export const PII_REQUEST_MAX_COUNT = 2_000

/**
 * Max characters of one text in one Presidio NER pass: spaCy's default
 * `max_length`, past which it refuses the text outright (the Presidio service
 * answers 422). Every text Presidio accepts is still sent whole, so no entity can
 * straddle a cut in it; only a longer text, which could never be masked whole, is
 * split by {@link segmentTexts}, following spaCy's guidance to segment long
 * documents before NER. A JavaScript length counts UTF-16 units, never fewer than
 * the code points spaCy counts, so a text within it is always within spaCy's.
 */
export const PII_MAX_TEXT_CHARS = 1_000_000

/**
 * The shortest piece a cut may leave, so a boundary is never chosen so early that
 * a long text splinters into many tiny requests.
 */
const MIN_SEGMENT_CHARS = PII_MAX_TEXT_CHARS / 2

/** Letters, combining marks, digits, and `_`: characters an entity can run through. */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u

/**
 * Structural delimiters (JSON, CSV, markup) that no detected entity contains, unlike
 * the `.`, `@`, `-`, `+`, `:`, and `/` inside emails, URLs, phone numbers, and ids.
 */
const STRUCTURAL_DELIMITER = /[,;"`()[\]{}<>|]/

function isSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * Where to end the piece of `text` that starts at `start`, at most
 * {@link PII_MAX_TEXT_CHARS} later and no earlier than {@link MIN_SEGMENT_CHARS}.
 * Prefers the end of a line, then whitespace, then a structural delimiter, then any
 * other punctuation, since NER and Presidio's pattern recognizers match within
 * those boundaries and an entity that straddles a cut would be missed. Only a run
 * with no boundary at all is cut mid-run, and never between the two halves of a
 * surrogate pair.
 */
function cutPoint(text: string, start: number): number {
  const limit = start + PII_MAX_TEXT_CHARS
  const floor = start + MIN_SEGMENT_CHARS

  const newline = text.slice(floor, limit).lastIndexOf('\n')
  if (newline !== -1) return floor + newline + 1

  for (let i = limit - 1; i >= floor; i--) {
    if (/\s/.test(text[i])) return i + 1
  }
  for (let i = limit - 1; i >= floor; i--) {
    if (STRUCTURAL_DELIMITER.test(text[i])) return i + 1
  }
  for (let i = limit - 1; i >= floor; i--) {
    if (!isSurrogate(text.charCodeAt(i)) && !WORD_CHARACTER.test(text[i])) return i + 1
  }
  return isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit
}

/** Every text's pieces, in order, each within {@link PII_MAX_TEXT_CHARS}. */
export interface SegmentedTexts {
  segments: string[]
  /** `owners[k]` is the index of the input text `segments[k]` was cut from. */
  owners: number[]
}

/**
 * Split each text longer than {@link PII_MAX_TEXT_CHARS} into consecutive pieces
 * (see {@link cutPoint}); shorter texts pass through as one piece. The pieces of a
 * text concatenate back to it exactly, so masking them one by one and joining them
 * with {@link joinSegments} masks the whole text.
 */
export function segmentTexts(texts: string[]): SegmentedTexts {
  const segments: string[] = []
  const owners: number[] = []
  texts.forEach((text, owner) => {
    let start = 0
    while (text.length - start > PII_MAX_TEXT_CHARS) {
      const end = cutPoint(text, start)
      segments.push(text.slice(start, end))
      owners.push(owner)
      start = end
    }
    segments.push(text.slice(start))
    owners.push(owner)
  })
  return { segments, owners }
}

/** Concatenate masked pieces back into one string per original text, in order. */
export function joinSegments(pieces: string[], owners: number[], textCount: number): string[] {
  const joined = new Array<string>(textCount).fill('')
  pieces.forEach((piece, k) => {
    joined[owners[k]] += piece
  })
  return joined
}

/**
 * Group `texts` into chunks of original indices, flushing a chunk when adding the
 * next string would exceed {@link PII_REQUEST_MAX_BYTES} or {@link PII_REQUEST_MAX_COUNT}.
 * A single string larger than the byte budget still gets its own chunk — strings
 * are never dropped, since an unredacted leaf would persist PII. Order is preserved
 * across and within chunks.
 */
export function chunkIndicesByBudget(texts: string[]): number[][] {
  const chunks: number[][] = []
  let current: number[] = []
  let bytes = 0

  for (let i = 0; i < texts.length; i++) {
    const size = Buffer.byteLength(texts[i], 'utf8')
    if (
      current.length > 0 &&
      (current.length >= PII_REQUEST_MAX_COUNT || bytes + size > PII_REQUEST_MAX_BYTES)
    ) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(i)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)

  return chunks
}
