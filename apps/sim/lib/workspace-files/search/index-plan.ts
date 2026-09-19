import { Buffer } from 'node:buffer'
import {
  FILE_SEARCH_CANDIDATE_LITERAL_CHARS,
  FILE_SEARCH_CHUNK_BYTES,
  FILE_SEARCH_ENCODED_EXCLUSION_MIN_BYTES,
  FILE_SEARCH_ENCODED_EXCLUSION_RATIO,
  FILE_SEARCH_ENCODED_RUN_MIN_CHARS,
  FILE_SEARCH_MAX_EXTRACTED_BYTES,
} from '@/lib/workspace-files/search/constants'
import type { ExtractedIndexText } from '@/lib/workspace-files/search/extract'

export type FileSearchExclusionReason =
  | 'extracted_text_too_large'
  | 'incomplete_extraction'
  | 'encoded_content'

const TRIGRAM_WORD = /[\p{L}\p{N}]+/gu

/**
 * Bytes inside long base64 runs, in one linear pass. A run counts only when it mixes upper case,
 * lower case, and digits, as real base64 does; single-case runs such as hex digests or DNA
 * sequences are searchable text with few distinct trigrams. Runs are ASCII, so chars are bytes.
 */
function countEncodedBytes(text: string): number {
  let encoded = 0
  let run = 0
  let upper = false
  let lower = false
  let digit = false
  const endRun = () => {
    if (run >= FILE_SEARCH_ENCODED_RUN_MIN_CHARS && upper && lower && digit) encoded += run
    run = 0
    upper = lower = digit = false
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const isUpper = code >= 65 && code <= 90
    const isLower = code >= 97 && code <= 122
    const isDigit = code >= 48 && code <= 57
    if (isUpper || isLower || isDigit || code === 43 || code === 47) {
      run++
      upper ||= isUpper
      lower ||= isLower
      digit ||= isDigit
    } else {
      endRun()
    }
  }
  endRun()
  return encoded
}

/**
 * Distinct keys `gin_trgm_ops` extracts from `content`, mirroring pg_trgm: lowercased alphanumeric
 * words, each padded with two leading spaces and one trailing space. This matches PostgreSQL under
 * the `en_US.UTF-8` ctype; its hashing of multibyte trigrams can only merge keys, so the count is
 * never an underestimate.
 */
export function estimateTrigramKeys(content: string): number {
  const keys = new Set<string>()
  for (const [word] of content.toLowerCase().matchAll(TRIGRAM_WORD)) {
    const padded = [' ', ' ', ...word, ' ']
    for (let i = 2; i < padded.length; i++) keys.add(padded[i - 2] + padded[i - 1] + padded[i])
  }
  return keys.size
}

export class FileSearchExclusionError extends Error {
  constructor(readonly reason: FileSearchExclusionReason) {
    super(`File cannot be fully indexed: ${reason}`)
    this.name = 'FileSearchExclusionError'
  }
}

export interface FileSearchChunk {
  ordinal: number
  lineStart: number
  fragment: boolean
  /** Unicode characters repeated from the preceding fragment, excluded during reconstruction. */
  overlap: number
  content: string
}

export interface FileSearchIndexPlan {
  bytes: Buffer
  lineCount: number
  indexedBytes: number
}

/**
 * Admission happens before any chunks are written; incomplete extraction never becomes searchable,
 * and neither does text that is mostly an encoded payload.
 */
export function planFileSearchIndex(
  extracted: ExtractedIndexText,
  signal: AbortSignal
): FileSearchIndexPlan {
  signal.throwIfAborted()
  if (extracted.partial) throw new FileSearchExclusionError('incomplete_extraction')
  const textBytes = Buffer.byteLength(extracted.text, 'utf8')
  if (textBytes > FILE_SEARCH_MAX_EXTRACTED_BYTES) {
    throw new FileSearchExclusionError('extracted_text_too_large')
  }
  const encodedBytes = countEncodedBytes(extracted.text)
  if (
    encodedBytes > FILE_SEARCH_ENCODED_EXCLUSION_MIN_BYTES &&
    encodedBytes >= textBytes * FILE_SEARCH_ENCODED_EXCLUSION_RATIO
  ) {
    throw new FileSearchExclusionError('encoded_content')
  }
  const bytes = Buffer.from(extracted.text.replace(/\r(?=\n|$)/g, ''), 'utf8')
  let lineCount = 1
  for (const byte of bytes) if (byte === 10) lineCount++
  if (bytes.at(-1) === 10) lineCount--
  return { bytes, lineCount, indexedBytes: bytes.length }
}

/** Packs short lines together and yields long-line fragments without accumulating a row per line. */
export function* iterateFileSearchChunks(
  plan: FileSearchIndexPlan,
  signal: AbortSignal
): Generator<FileSearchChunk> {
  const { bytes } = plan
  let ordinal = 0
  let lineStart = 0
  let lineNumber = 1
  let blockStart = 0
  let blockLine = 1
  const chunk = (
    start: number,
    end: number,
    line: number,
    fragment = false,
    overlap = 0
  ): FileSearchChunk => ({
    ordinal: ordinal++,
    lineStart: line,
    fragment,
    overlap,
    content: bytes.subarray(start, end).toString('utf8'),
  })
  while (lineStart < bytes.length) {
    signal.throwIfAborted()
    const newline = bytes.indexOf(10, lineStart)
    const lineEnd = newline < 0 ? bytes.length : newline
    const nextLine = newline < 0 ? bytes.length : newline + 1
    if (nextLine - lineStart > FILE_SEARCH_CHUNK_BYTES) {
      if (lineStart > blockStart) yield chunk(blockStart, lineStart, blockLine)
      let overlap = 0
      for (let position = lineStart; position < lineEnd; ) {
        let end = Math.min(position + FILE_SEARCH_CHUNK_BYTES, lineEnd)
        while (end < lineEnd && (bytes[end] & 0xc0) === 0x80) end--
        yield chunk(position, end, lineNumber, true, overlap)
        if (end === lineEnd) break
        position = end
        overlap = 0
        while (overlap < FILE_SEARCH_CANDIDATE_LITERAL_CHARS - 1 && position > lineStart) {
          position--
          while (position > lineStart && (bytes[position] & 0xc0) === 0x80) position--
          overlap++
        }
      }
      blockStart = nextLine
      blockLine = lineNumber + 1
    } else if (nextLine - blockStart > FILE_SEARCH_CHUNK_BYTES) {
      yield chunk(blockStart, lineStart, blockLine)
      blockStart = lineStart
      blockLine = lineNumber
    }
    lineStart = nextLine
    lineNumber++
  }
  if (bytes.length > blockStart) yield chunk(blockStart, bytes.length, blockLine)
}
