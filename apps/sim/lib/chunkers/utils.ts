import type { Chunk } from '@/lib/chunkers/types'

const MAX_TOKEN_CHUNK_SIZE = Math.floor(Number.MAX_SAFE_INTEGER / 4)

/** 1 token ≈ 4 characters for English text */
export function estimateTokens(text: string): number {
  if (!text?.trim()) return 0
  return Math.ceil(text.length / 4)
}

export function tokensToChars(tokens: number): number {
  return tokens * 4
}

export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

export function normalizeTokenChunkSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1 || value > MAX_TOKEN_CHUNK_SIZE) {
    throw new Error(`${name} must be a finite number between 1 and ${MAX_TOKEN_CHUNK_SIZE}`)
  }
  return Math.floor(value)
}

export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

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
        chunk = `${cleanOverlap.trim()} ${chunk}`
      }
    }

    result.push(chunk)
  }

  return result
}

/**
 * When stepChars is provided (< chunkSizeChars), produces overlapping chunks
 * using a sliding window where chunks stay within the size limit.
 */
export function splitAtWordBoundaries(
  text: string,
  chunkSizeChars: number,
  stepChars?: number
): string[] {
  return Array.from(iterateWordBoundaryChunks(text, chunkSizeChars, stepChars))
}

export interface WordBoundaryChunkSpan {
  text: string
  startIndex: number
  endIndex: number
}

/** Iterates bounded word-aware source slices without trimming or skipping characters. */
export function* iterateLosslessWordBoundaryChunkSpans(
  text: string,
  chunkSizeChars: number
): Generator<WordBoundaryChunkSpan> {
  assertPositiveSafeInteger(chunkSizeChars, 'Lossless word-boundary chunk size')

  let startIndex = 0
  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + chunkSizeChars, text.length)
    if (endIndex < text.length) {
      const lastSpace = text.lastIndexOf(' ', endIndex - 1)
      if (lastSpace > startIndex) endIndex = lastSpace + 1
    }
    yield { text: text.slice(startIndex, endIndex), startIndex, endIndex }
    startIndex = endIndex
  }
}

/** Iterates trimmed word-boundary chunks while preserving their source offsets. */
export function* iterateWordBoundaryChunkSpans(
  text: string,
  chunkSizeChars: number,
  stepChars?: number
): Generator<WordBoundaryChunkSpan> {
  assertPositiveSafeInteger(chunkSizeChars, 'Word-boundary chunk size')

  let pos = 0

  while (pos < text.length) {
    let end = Math.min(pos + chunkSizeChars, text.length)

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end)
      if (lastSpace > pos) end = lastSpace
    }

    const rawPart = text.slice(pos, end)
    const startIndex = pos + (rawPart.length - rawPart.trimStart().length)
    const endIndex = end - (rawPart.length - rawPart.trimEnd().length)
    if (endIndex > startIndex) {
      yield { text: text.slice(startIndex, endIndex), startIndex, endIndex }
    }

    if (stepChars !== undefined) {
      const nextPos = pos + Math.max(1, stepChars)
      if (nextPos >= text.length) break
      pos = nextPos
    } else {
      if (end >= text.length) break
      pos = end
    }
    while (pos < text.length && text[pos] === ' ') pos++
  }
}

export function* iterateWordBoundaryChunks(
  text: string,
  chunkSizeChars: number,
  stepChars?: number
): Generator<string> {
  for (const span of iterateWordBoundaryChunkSpans(text, chunkSizeChars, stepChars)) {
    yield span.text
  }
}

/** Iterates literal-separated parts while preserving String.split's raw part values. */
export function* iterateLiteralParts(text: string, separator: string): Generator<string> {
  if (!separator) {
    yield text
    return
  }

  let cursor = 0
  while (cursor <= text.length) {
    const next = text.indexOf(separator, cursor)
    if (next === -1) {
      yield text.slice(cursor)
      return
    }
    yield text.slice(cursor, next)
    cursor = next + separator.length
  }
}

export function hasMultipleNonEmptyLiteralParts(text: string, separator: string): boolean {
  let nonEmptyParts = 0
  for (const part of iterateLiteralParts(text, separator)) {
    if (!part.trim()) continue
    nonEmptyParts++
    if (nonEmptyParts === 2) return true
  }
  return false
}

/** Iterates lines without allocating an array proportional to line count. */
export function* iterateLines(text: string): Generator<string> {
  let cursor = 0
  while (cursor <= text.length) {
    const next = text.indexOf('\n', cursor)
    if (next === -1) {
      yield text.slice(cursor)
      return
    }
    yield text.slice(cursor, next)
    cursor = next + 1
  }
}

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

export function resolveChunkerOptions(options: {
  chunkSize?: number
  chunkOverlap?: number
  minCharactersPerChunk?: number
}): { chunkSize: number; chunkOverlap: number; minCharactersPerChunk: number } {
  const chunkSize = normalizeTokenChunkSize(options.chunkSize ?? 1024, 'Chunk size')
  const maxOverlap = Math.floor(chunkSize * 0.5)
  return {
    chunkSize,
    chunkOverlap: Math.min(options.chunkOverlap ?? 0, maxOverlap),
    minCharactersPerChunk: options.minCharactersPerChunk ?? 100,
  }
}
