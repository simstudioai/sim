import { ChunkBudget } from '@/lib/chunkers/chunk-budget'
import type { Chunk, ChunkerOptions } from '@/lib/chunkers/types'
import {
  addOverlap,
  buildChunks,
  cleanText,
  estimateTokens,
  hasMultipleNonEmptyLiteralParts,
  iterateLiteralParts,
  iterateWordBoundaryChunks,
  resolveChunkerOptions,
  tokensToChars,
} from '@/lib/chunkers/utils'

export class TextChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly maxChunks?: number

  private readonly separators = [
    '\n---\n',
    '\n***\n',
    '\n___\n',
    '\n# ',
    '\n## ',
    '\n### ',
    '\n#### ',
    '\n##### ',
    '\n###### ',
    '\n\n',
    '\n',
    '. ',
    '! ',
    '? ',
    '; ',
    ', ',
    ' ',
  ]

  constructor(options: ChunkerOptions = {}) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.maxChunks = options.maxChunks
  }

  private splitRecursively(
    text: string,
    chunks: string[],
    budget: ChunkBudget,
    separatorIndex = 0
  ): void {
    const tokenCount = estimateTokens(text)

    if (tokenCount <= this.chunkSize) {
      if (text.trim()) budget.add(chunks, text)
      return
    }

    if (separatorIndex >= this.separators.length) {
      const chunkSizeChars = tokensToChars(this.chunkSize)
      for (const part of iterateWordBoundaryChunks(text, chunkSizeChars)) {
        budget.add(chunks, part)
      }
      return
    }

    const separator = this.separators[separatorIndex]
    if (!hasMultipleNonEmptyLiteralParts(text, separator)) {
      this.splitRecursively(text, chunks, budget, separatorIndex + 1)
      return
    }

    let currentChunk = ''

    for (const part of iterateLiteralParts(text, separator)) {
      if (!part.trim()) continue
      const testChunk = currentChunk + (currentChunk ? separator : '') + part

      if (estimateTokens(testChunk) <= this.chunkSize) {
        currentChunk = testChunk
      } else {
        if (currentChunk.trim()) {
          budget.add(chunks, currentChunk.trim())
        }

        if (estimateTokens(part) > this.chunkSize) {
          this.splitRecursively(part, chunks, budget, separatorIndex + 1)
          currentChunk = ''
        } else {
          currentChunk = part
        }
      }
    }

    if (currentChunk.trim()) {
      budget.add(chunks, currentChunk.trim())
    }
  }

  async chunk(text: string): Promise<Chunk[]> {
    if (!text?.trim()) {
      return []
    }

    const cleaned = cleanText(text)
    let chunks: string[] = []
    this.splitRecursively(cleaned, chunks, new ChunkBudget(this.maxChunks))

    if (this.chunkOverlap > 0) {
      const overlapChars = tokensToChars(this.chunkOverlap)
      chunks = addOverlap(chunks, overlapChars)
    }

    return buildChunks(chunks, this.chunkOverlap)
  }
}
