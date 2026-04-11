import { createLogger } from '@sim/logger'
import type { Chunk, ChunkerOptions } from '@/lib/chunkers/types'
import {
  addOverlap,
  buildChunks,
  cleanText,
  estimateTokens,
  resolveChunkerOptions,
  splitAtWordBoundaries,
  tokensToChars,
} from '@/lib/chunkers/utils'

const logger = createLogger('TokenChunker')

/**
 * Fixed-size token chunker
 * Splits text into chunks of a fixed token size with configurable overlap.
 * Snaps boundaries to word boundaries for cleaner output.
 */
export class TokenChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly minCharactersPerChunk: number

  constructor(options: ChunkerOptions = {}) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.minCharactersPerChunk = resolved.minCharactersPerChunk
  }

  async chunk(content: string): Promise<Chunk[]> {
    if (!content?.trim()) {
      return []
    }

    const cleaned = cleanText(content)

    if (estimateTokens(cleaned) <= this.chunkSize) {
      logger.info('Content fits in single chunk')
      return buildChunks([cleaned], 0)
    }

    const chunkSizeChars = tokensToChars(this.chunkSize)
    const rawChunks = splitAtWordBoundaries(cleaned, chunkSizeChars)

    const filtered =
      rawChunks.length > 1
        ? rawChunks.filter((c) => c.length >= this.minCharactersPerChunk)
        : rawChunks

    let chunks = filtered.length > 0 ? filtered : rawChunks

    if (this.chunkOverlap > 0) {
      const overlapChars = tokensToChars(this.chunkOverlap)
      chunks = addOverlap(chunks, overlapChars)
    }

    logger.info(`Chunked into ${chunks.length} token-based chunks`)
    return buildChunks(chunks, this.chunkOverlap)
  }
}
