import { createLogger } from '@sim/logger'
import type { Chunk, RegexChunkerOptions } from '@/lib/chunkers/types'
import {
  addOverlap,
  buildChunks,
  cleanText,
  estimateTokens,
  resolveChunkerOptions,
  splitAtWordBoundaries,
  tokensToChars,
} from '@/lib/chunkers/utils'

const logger = createLogger('RegexChunker')

const MAX_PATTERN_LENGTH = 500

export class RegexChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly regex: RegExp

  constructor(options: RegexChunkerOptions) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.regex = this.compilePattern(options.pattern)
  }

  private compilePattern(pattern: string): RegExp {
    if (!pattern) {
      throw new Error('Regex pattern is required')
    }

    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`)
    }

    try {
      const regex = new RegExp(pattern, 'g')

      const testStrings = [
        'a'.repeat(10000),
        ' '.repeat(10000),
        'a '.repeat(5000),
        'aB1 xY2\n'.repeat(1250),
        `${'a'.repeat(30)}!`,
        `${'a b '.repeat(25)}!`,
      ]
      for (const testStr of testStrings) {
        regex.lastIndex = 0
        const start = Date.now()
        regex.test(testStr)
        const elapsed = Date.now() - start
        if (elapsed > 50) {
          throw new Error('Regex pattern appears to have catastrophic backtracking')
        }
      }

      regex.lastIndex = 0
      return regex
    } catch (error) {
      if (error instanceof Error && error.message.includes('catastrophic')) {
        throw error
      }
      throw new Error(
        `Invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`
      )
    }
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

    this.regex.lastIndex = 0
    const segments = cleaned.split(this.regex).filter((s) => s.trim().length > 0)

    if (segments.length <= 1) {
      logger.warn(
        'Regex pattern did not produce any splits, falling back to word-boundary splitting'
      )
      const chunkSizeChars = tokensToChars(this.chunkSize)
      let chunks = splitAtWordBoundaries(cleaned, chunkSizeChars)
      if (this.chunkOverlap > 0) {
        const overlapChars = tokensToChars(this.chunkOverlap)
        chunks = addOverlap(chunks, overlapChars)
      }
      return buildChunks(chunks, this.chunkOverlap)
    }

    const merged = this.mergeSegments(segments)

    let chunks = merged
    if (this.chunkOverlap > 0) {
      const overlapChars = tokensToChars(this.chunkOverlap)
      chunks = addOverlap(chunks, overlapChars)
    }

    logger.info(`Chunked into ${chunks.length} regex-based chunks`)
    return buildChunks(chunks, this.chunkOverlap)
  }

  private mergeSegments(segments: string[]): string[] {
    const chunks: string[] = []
    let current = ''

    for (const segment of segments) {
      const test = current ? `${current}\n${segment}` : segment

      if (estimateTokens(test) <= this.chunkSize) {
        current = test
      } else {
        if (current.trim()) {
          chunks.push(current.trim())
        }

        if (estimateTokens(segment) > this.chunkSize) {
          const chunkSizeChars = tokensToChars(this.chunkSize)
          const subChunks = splitAtWordBoundaries(segment, chunkSizeChars)
          for (const sub of subChunks) {
            chunks.push(sub)
          }
          current = ''
        } else {
          current = segment
        }
      }
    }

    if (current.trim()) {
      chunks.push(current.trim())
    }

    return chunks
  }
}
