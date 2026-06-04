import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
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

const NAMED_GROUP_PREFIX = /^\(\?<(?![=!])[^>]+>/

/**
 * Converts unescaped capturing groups `(...)` and named capturing groups
 * `(?<name>...)` into non-capturing groups `(?:...)`. `String.prototype.split()`
 * interleaves captured text (named or otherwise) into the result array, which
 * would surface delimiter text as spurious chunks. Lookarounds (`(?=`, `(?!`,
 * `(?<=`, `(?<!`) and other `(?...)` constructs are left untouched.
 */
function toNonCapturing(pattern: string): string {
  let result = ''
  let inClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) {
      result += c + pattern[i + 1]
      i++
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    if (!inClass && c === '(') {
      if (pattern[i + 1] !== '?') {
        result += '(?:'
        continue
      }
      const namedMatch = pattern.slice(i).match(NAMED_GROUP_PREFIX)
      if (namedMatch) {
        result += '(?:'
        i += namedMatch[0].length - 1
        continue
      }
    }
    result += c
  }
  return result
}

export class RegexChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly regex: RegExp
  private readonly strictBoundaries: boolean

  constructor(options: RegexChunkerOptions) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.regex = this.compilePattern(options.pattern)
    this.strictBoundaries = options.strictBoundaries ?? false
  }

  private compilePattern(pattern: string): RegExp {
    if (!pattern) {
      throw new Error('Regex pattern is required')
    }

    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`)
    }

    try {
      const regex = new RegExp(toNonCapturing(pattern), 'g')

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
      throw new Error(`Invalid regex pattern "${pattern}": ${toError(error).message}`)
    }
  }

  async chunk(content: string): Promise<Chunk[]> {
    if (!content?.trim()) {
      return []
    }

    const cleaned = cleanText(content)

    if (!this.strictBoundaries && estimateTokens(cleaned) <= this.chunkSize) {
      logger.info('Content fits in single chunk')
      return buildChunks([cleaned], 0)
    }

    this.regex.lastIndex = 0
    const segments = cleaned.split(this.regex).filter((s) => s.trim().length > 0)

    if (segments.length <= 1) {
      if (this.strictBoundaries) {
        logger.info('Regex pattern produced no splits in strict mode, returning single chunk')
        return buildChunks([cleaned.trim()], 0)
      }
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

    if (this.strictBoundaries) {
      const chunks = this.expandOversizedSegments(segments)
      logger.info(`Chunked into ${chunks.length} strict-boundary regex chunks`)
      return buildChunks(chunks, 0)
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

  /**
   * In strict-boundary mode each segment becomes its own chunk. Segments that
   * exceed chunkSize are still split at word boundaries to preserve the token
   * limit invariant; this is a safety floor, not a merge.
   */
  private expandOversizedSegments(segments: string[]): string[] {
    const result: string[] = []
    const chunkSizeChars = tokensToChars(this.chunkSize)

    for (const segment of segments) {
      const trimmed = segment.trim()
      if (!trimmed) continue

      if (estimateTokens(trimmed) <= this.chunkSize) {
        result.push(trimmed)
      } else {
        const subChunks = splitAtWordBoundaries(trimmed, chunkSizeChars)
        for (const sub of subChunks) {
          if (sub.trim()) result.push(sub)
        }
      }
    }

    return result
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
