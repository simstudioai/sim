import { createLogger } from '@sim/logger'
import { MAX_CHUNKING_SEPARATOR_LENGTH, MAX_CHUNKING_SEPARATORS } from '@/lib/chunkers/constants'
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

    /**
     * Bounded here as well as at the API boundary: a config persisted before the
     * boundary bound existed would otherwise still cost one full document scan
     * per separator, synchronously, on every document it processes.
     *
     * An over-long separator is dropped rather than truncated — a truncated
     * separator matches where the configured one never did, silently re-cutting
     * the document, whereas dropping it behaves like a separator that finds no
     * match, which the split already handles.
     */
    const requested = options.separators ?? []
    const usable = requested
      .filter((separator) => separator.length <= MAX_CHUNKING_SEPARATOR_LENGTH)
      .slice(0, MAX_CHUNKING_SEPARATORS)

    if (usable.length < requested.length) {
      logger.warn(
        `Chunking config carries ${requested.length} separators; using ${usable.length} within the ${MAX_CHUNKING_SEPARATORS} × ${MAX_CHUNKING_SEPARATOR_LENGTH}-character bound`
      )
    }

    if (usable.length > 0) {
      this.separators = usable
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

    /**
     * Advance past separators that do not split this text. Iterating rather
     * than recursing keeps stack depth independent of the separator count.
     */
    let index = separatorIndex
    let separator = ''
    let parts: string[] = []

    while (index < this.separators.length) {
      separator = this.separators[index]

      if (separator === '') {
        index = this.separators.length
        break
      }

      parts = text.split(separator).filter((part) => part.trim())

      if (parts.length > 1) {
        break
      }

      index++
    }

    if (index >= this.separators.length) {
      const chunkSizeChars = tokensToChars(this.chunkSize)
      return splitAtWordBoundaries(text, chunkSizeChars)
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
          const subChunks = this.splitRecursively(part, index + 1)
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
