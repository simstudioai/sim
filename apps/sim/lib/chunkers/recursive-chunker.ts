import { createLogger } from '@sim/logger'
import type { Chunk, RecursiveChunkerOptions } from '@/lib/chunkers/types'
import {
  addOverlap,
  buildChunks,
  cleanText,
  estimateTokens,
  resolveChunkerOptions,
  splitAtWordBoundaries,
  tokensToChars,
} from '@/lib/chunkers/utils'

const logger = createLogger('RecursiveChunker')

const RECIPES = {
  plain: ['\n\n', '\n', '. ', ' ', ''],
  markdown: [
    '\n---\n',
    '\n***\n',
    '\n___\n',
    '\n# ',
    '\n## ',
    '\n### ',
    '\n#### ',
    '\n##### ',
    '\n###### ',
    '\n```\n',
    '\n> ',
    '\n\n',
    '\n',
    '. ',
    ' ',
    '',
  ],
  code: [
    '\nfunction ',
    '\nclass ',
    '\nexport ',
    '\nconst ',
    '\nlet ',
    '\nvar ',
    '\nif ',
    '\nfor ',
    '\nwhile ',
    '\nswitch ',
    '\nreturn ',
    '\n\n',
    '\n',
    '; ',
    ' ',
    '',
  ],
} as const

export class RecursiveChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly separators: string[]

  constructor(options: RecursiveChunkerOptions = {}) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap

    if (options.separators && options.separators.length > 0) {
      this.separators = options.separators
    } else {
      const recipe = options.recipe ?? 'plain'
      this.separators = [...RECIPES[recipe]]
    }
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

    if (separator === '') {
      return this.splitRecursively(text, this.separators.length)
    }

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

  async chunk(content: string): Promise<Chunk[]> {
    if (!content?.trim()) {
      return []
    }

    const cleaned = cleanText(content)
    let chunks = this.splitRecursively(cleaned)

    if (this.chunkOverlap > 0) {
      const overlapChars = tokensToChars(this.chunkOverlap)
      chunks = addOverlap(chunks, overlapChars)
    }

    logger.info(`Chunked into ${chunks.length} recursive chunks`)
    return buildChunks(chunks, this.chunkOverlap)
  }
}
