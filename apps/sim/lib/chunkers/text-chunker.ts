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

export class TextChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number

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
  }

  private splitRecursively(text: string, separatorIndex = 0): string[] {
    const tokenCount = estimateTokens(text)

    if (tokenCount <= this.chunkSize) {
      return text.trim() ? [text] : []
    }

    if (separatorIndex >= this.separators.length) {
      const chunkSizeChars = tokensToChars(this.chunkSize)
      return splitAtWordBoundaries(text, chunkSizeChars)
    }

    const separator = this.separators[separatorIndex]
    const parts = text.split(separator).filter((part) => part.trim())

    if (parts.length <= 1) {
      return this.splitRecursively(text, separatorIndex + 1)
    }

    const chunks: string[] = []
    let currentChunk = ''

    for (const part of parts) {
      const testChunk = currentChunk + (currentChunk ? separator : '') + part

      if (estimateTokens(testChunk) <= this.chunkSize) {
        currentChunk = testChunk
      } else {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim())
        }

        if (estimateTokens(part) > this.chunkSize) {
          const subChunks = this.splitRecursively(part, separatorIndex + 1)
          for (const subChunk of subChunks) {
            chunks.push(subChunk)
          }
          currentChunk = ''
        } else {
          currentChunk = part
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }

    return chunks
  }

  async chunk(text: string): Promise<Chunk[]> {
    if (!text?.trim()) {
      return []
    }

    const cleaned = cleanText(text)
    let chunks = this.splitRecursively(cleaned)

    if (this.chunkOverlap > 0) {
      const overlapChars = tokensToChars(this.chunkOverlap)
      chunks = addOverlap(chunks, overlapChars)
    }

    return buildChunks(chunks, this.chunkOverlap)
  }
}
