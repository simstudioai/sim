import type { Chunk } from '@/lib/chunkers/types'

/**
 * Estimate token count from text length
 * 1 token ≈ 4 characters for English text
 */
export function estimateTokens(text: string): number {
  if (!text?.trim()) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Convert token count to approximate character count
 */
export function tokensToChars(tokens: number): number {
  return tokens * 4
}

/**
 * Clean and normalize text for chunking
 */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/**
 * Add overlap between consecutive chunks using word-boundary alignment
 * Overlap is specified in characters
 */
export function addOverlap(chunks: string[], overlapChars: number): string[] {
  if (overlapChars <= 0 || chunks.length <= 1) {
    return chunks
  }

  const result: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i]

    if (i > 0) {
      const prevChunk = chunks[i - 1]
      const overlapLength = Math.min(overlapChars, prevChunk.length)
      const overlapText = prevChunk.slice(-overlapLength)

      const wordBoundaryMatch = overlapText.match(/^\s*\S/)
      const cleanOverlap = wordBoundaryMatch
        ? overlapText.slice(overlapText.indexOf(wordBoundaryMatch[0].trim()))
        : overlapText

      if (cleanOverlap.trim()) {
        chunk = `${cleanOverlap.trim()}\n${chunk}`
      }
    }

    result.push(chunk)
  }

  return result
}

/**
 * Split text at word boundaries into segments of approximately chunkSizeChars.
 * When stepChars is provided (< chunkSizeChars), produces overlapping chunks
 * using a sliding window, matching LangChain/Chonkie behavior where
 * chunks stay within the size limit.
 */
export function splitAtWordBoundaries(
  text: string,
  chunkSizeChars: number,
  stepChars?: number
): string[] {
  const step = stepChars ?? chunkSizeChars
  const parts: string[] = []
  let pos = 0

  while (pos < text.length) {
    let end = Math.min(pos + chunkSizeChars, text.length)

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end)
      if (lastSpace > pos) {
        end = lastSpace
      }
    }

    const part = text.slice(pos, end).trim()
    if (part) {
      parts.push(part)
    }

    const nextPos = pos + step
    if (nextPos >= text.length) break
    pos = nextPos
    while (pos < text.length && text[pos] === ' ') pos++
  }

  return parts
}

/**
 * Build Chunk objects from text segments with startIndex/endIndex metadata
 */
export function buildChunks(texts: string[], overlapTokens: number): Chunk[] {
  let previousEndIndex = 0
  const overlapChars = tokensToChars(overlapTokens)

  return texts.map((text, index) => {
    let startIndex: number
    let actualContentLength: number

    if (index === 0 || overlapTokens <= 0) {
      startIndex = previousEndIndex
      actualContentLength = text.length
    } else {
      const prevChunk = texts[index - 1]
      const overlapLength = Math.min(overlapChars, prevChunk.length, text.length)
      startIndex = previousEndIndex - overlapLength
      actualContentLength = text.length - overlapLength
    }

    const safeStart = Math.max(0, startIndex)
    const endIndex = safeStart + Math.max(0, actualContentLength)

    previousEndIndex = endIndex

    return {
      text,
      tokenCount: estimateTokens(text),
      metadata: {
        startIndex: safeStart,
        endIndex,
      },
    }
  })
}

/**
 * Resolve common chunker options with defaults and clamping
 */
export function resolveChunkerOptions(options: {
  chunkSize?: number
  chunkOverlap?: number
  minCharactersPerChunk?: number
}): { chunkSize: number; chunkOverlap: number; minCharactersPerChunk: number } {
  const chunkSize = options.chunkSize ?? 1024
  const maxOverlap = Math.floor(chunkSize * 0.5)
  return {
    chunkSize,
    chunkOverlap: Math.min(options.chunkOverlap ?? 0, maxOverlap),
    minCharactersPerChunk: options.minCharactersPerChunk ?? 100,
  }
}
