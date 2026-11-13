import { encodedWindowEnd, READ_WINDOW_CHARACTERS } from '@/lib/sim-search/live/read-window'

/**
 * Characters of document text one batched read call returns. With about a thousand characters of
 * metadata per document, it keeps the call under the 50,000-character size at which MCP clients
 * such as Claude Code save a tool result to a file rather than show it. More than five long
 * documents exceed it, since none is cut below its standard page.
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
 * Shares one call's text budget across the documents it read; an entry without text, such as a
 * failed read, passes through. Documents shorter than an even share keep all their text and leave
 * the rest to the longer ones, which are cut to an equal share and continue through `next`. No
 * document is cut below the standard page.
 */
export function shareReadBudget<T extends object>(reads: readonly T[]): T[] {
  const lengths = reads.map((read) =>
    isWindowedRead(read)
      ? read.chunks.reduce((total, chunk) => total + encodedLength(chunk.content), 0)
      : 0
  )
  if (lengths.reduce((total, length) => total + length, 0) <= READ_CALL_CHARACTERS)
    return [...reads]
  let remaining = READ_CALL_CHARACTERS
  let left = reads.length
  let cap = 0
  for (const length of [...lengths].sort((a, b) => a - b)) {
    const share = Math.floor(remaining / left)
    if (length > share) {
      cap = share
      break
    }
    remaining -= length
    left--
  }
  return reads.map((read, index) =>
    isWindowedRead(read) && lengths[index] > cap ? cut(read, cap) : read
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
