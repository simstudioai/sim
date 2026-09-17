import { Buffer } from 'node:buffer'
import {
  FILE_SEARCH_CANDIDATE_LITERAL_CHARS,
  FILE_SEARCH_CHUNK_BYTES,
  FILE_SEARCH_MAX_EXTRACTED_BYTES,
} from '@/lib/workspace-files/search/constants'
import type { ExtractedIndexText } from '@/lib/workspace-files/search/extract'

export type FileSearchExclusionReason = 'extracted_text_too_large' | 'incomplete_extraction'

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

/** Admission happens before any chunks are written; incomplete extraction never becomes searchable. */
export function planFileSearchIndex(
  extracted: ExtractedIndexText,
  signal: AbortSignal
): FileSearchIndexPlan {
  signal.throwIfAborted()
  if (extracted.partial) throw new FileSearchExclusionError('incomplete_extraction')
  if (Buffer.byteLength(extracted.text, 'utf8') > FILE_SEARCH_MAX_EXTRACTED_BYTES) {
    throw new FileSearchExclusionError('extracted_text_too_large')
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
