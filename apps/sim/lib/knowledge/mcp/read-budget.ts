import { encodedWindowEnd, READ_WINDOW_CHARACTERS } from '@/lib/sim-search/live/read-window'

/**
 * Characters of document text one batched read call returns. With about a thousand characters of
 * metadata per document, it keeps the call under the 50,000-character size at which MCP clients
 * such as Claude Code save a tool result to a file rather than show it. A call whose standard
 * pages alone exceed it returns those pages, as a read without sharing would.
 */
const READ_CALL_CHARACTERS = 40_000

interface WindowedRead {
  chunks: { content: string; startOffset: number; endOffset: number }[]
  hasMore: boolean
  next: { startChunkIndex: number; startOffset: number } | null
}

const encodedLength = (text: string) => JSON.stringify(text).length - 2

const isWindowedRead = (document: object): document is WindowedRead => 'chunks' in document

/**
 * A read's text as JSON encodes it, and the part of that it always keeps: its standard page, or
 * all of it when it is not a single chunk this budget can shorten.
 */
function encodedSize(read: object): { length: number; kept: number } {
  if (!isWindowedRead(read)) return { length: 0, kept: 0 }
  const length = read.chunks.reduce((total, chunk) => total + encodedLength(chunk.content), 0)
  const [chunk] = read.chunks
  if (!chunk || read.chunks.length !== 1) return { length, kept: length }
  return { length, kept: encodedLength(chunk.content.slice(0, READ_WINDOW_CHARACTERS)) }
}

/**
 * Shares one call's text budget across the documents it read; an entry without text, such as a
 * failed read, passes through. Every document keeps its standard page, and the budget those pages
 * leave is shared as further text: documents needing less than an even share keep all theirs and
 * leave the rest to the longer ones, which are cut to an equal share and continue through `next`.
 */
export function shareReadBudget<T extends object>(reads: readonly T[]): T[] {
  const sizes = reads.map(encodedSize)
  if (sizes.reduce((total, size) => total + size.length, 0) <= READ_CALL_CHARACTERS)
    return [...reads]
  const extras = sizes.map((size) => size.length - size.kept)
  let remaining = READ_CALL_CHARACTERS - sizes.reduce((total, size) => total + size.kept, 0)
  let left = reads.length
  let cap = 0
  for (const extra of [...extras].sort((a, b) => a - b)) {
    const share = Math.max(0, Math.floor(remaining / left))
    if (extra > share) {
      cap = share
      break
    }
    remaining -= extra
    left--
  }
  return reads.map((read, index) =>
    isWindowedRead(read) && extras[index] > cap ? cut(read, sizes[index].kept + cap) : read
  )
}

/** A single-chunk read shortened so its text encodes within `budget`, continuing where it stops. */
function cut<T extends WindowedRead>(read: T, budget: number): T {
  const [chunk] = read.chunks
  if (!chunk || read.chunks.length !== 1) return read
  const end = encodedWindowEnd(
    chunk.content,
    0,
    budget,
    Math.min(chunk.content.length, READ_WINDOW_CHARACTERS)
  )
  if (end >= chunk.content.length) return read
  const endOffset = chunk.startOffset + end
  return {
    ...read,
    chunks: [{ ...chunk, content: chunk.content.slice(0, end), endOffset }],
    hasMore: true,
    next: { startChunkIndex: 0, startOffset: endOffset },
  }
}
