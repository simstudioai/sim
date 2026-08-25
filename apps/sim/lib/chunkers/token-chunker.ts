import { createLogger } from '@sim/logger'
import { ChunkBudget } from '@/lib/chunkers/chunk-budget'
import type { Chunk, ChunkerOptions } from '@/lib/chunkers/types'
import {
  buildChunks,
  cleanText,
  estimateTokens,
  iterateWordBoundaryChunks,
  resolveChunkerOptions,
  tokensToChars,
} from '@/lib/chunkers/utils'

const logger = createLogger('TokenChunker')

export class TokenChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly minCharactersPerChunk: number
  private readonly maxChunks?: number

  constructor(options: ChunkerOptions = {}) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.minCharactersPerChunk = resolved.minCharactersPerChunk
    this.maxChunks = options.maxChunks
  }

  async chunk(content: string): Promise<Chunk[]> {
    if (!content?.trim()) {
      return []
    }

    const cleaned = cleanText(content)
    const budget = new ChunkBudget(this.maxChunks)

    if (estimateTokens(cleaned) <= this.chunkSize) {
      logger.info('Content fits in single chunk')
      const texts: string[] = []
      budget.add(texts, cleaned)
      return buildChunks(texts, 0)
    }

    const chunkSizeChars = tokensToChars(this.chunkSize)
    const overlapChars = tokensToChars(this.chunkOverlap)
    const stepChars = this.chunkOverlap > 0 ? chunkSizeChars - overlapChars : undefined

    const rawChunks: string[] = []
    const filteredChunks: string[] = []
    const filteredBudget = new ChunkBudget(this.maxChunks)
    let rawChunkCount = 0
    for (const chunk of iterateWordBoundaryChunks(cleaned, chunkSizeChars, stepChars)) {
      rawChunkCount++
      if (this.maxChunks === undefined || rawChunks.length <= this.maxChunks) {
        rawChunks.push(chunk)
      }
      if (chunk.length >= this.minCharactersPerChunk) {
        filteredBudget.add(filteredChunks, chunk)
      }
    }

    let chunks = filteredChunks
    if (rawChunkCount <= 1 || filteredChunks.length === 0) {
      chunks = []
      for (const chunk of rawChunks) budget.add(chunks, chunk)
    }

    logger.info(`Chunked into ${chunks.length} token-based chunks`)
    return buildChunks(chunks, this.chunkOverlap)
  }
}
