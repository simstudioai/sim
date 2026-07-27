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
import {
  compileLinearRegex,
  compileLookaroundSplit,
  type LinearRegex,
} from '@/lib/core/security/linear-regex'

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
  private readonly regex: LinearRegex
  private readonly strictBoundaries: boolean

  constructor(options: RegexChunkerOptions) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.regex = this.compilePattern(options.pattern)
    this.strictBoundaries = options.strictBoundaries ?? false
  }

  /**
   * Compile the caller's split pattern on an engine that cannot backtrack.
   *
   * This previously screened for catastrophic backtracking by running the
   * pattern against six probe strings — including `'a'.repeat(10000)` — and
   * rejecting anything slower than 50ms. It measured the elapsed time *after*
   * the match returned, so the screen was the denial of service it existed to
   * prevent: `a*a*b` against that probe measured 213s on JSC. RE2 removes the
   * failure mode outright, so the probe is gone rather than repaired.
   *
   * Keeping the delimiter — `(?=X)` before a chunk, `(?<=X)` after one — is the
   * reason a split pattern reaches for lookaround, and `compileLookaroundSplit`
   * runs both on RE2 without it. Anything else RE2 cannot represent is rejected
   * rather than run on the built-in engine: no probe can tell a safe pattern
   * from an unsafe one without running it, which is what made the old guard
   * hang, so there is nothing to fall back *to*.
   */
  private compilePattern(pattern: string): LinearRegex {
    if (!pattern) {
      throw new Error('Regex pattern is required')
    }

    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(`Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`)
    }

    try {
      new RegExp(pattern)
    } catch (error) {
      throw new Error(`Invalid regex pattern "${pattern}": ${toError(error).message}`)
    }

    const source = toNonCapturing(pattern)
    const compiled = compileLinearRegex(source) ?? compileLookaroundSplit(source)
    if (compiled) return compiled

    throw new Error(
      `Regex pattern "${pattern}" uses syntax that cannot be evaluated safely (backreferences and negative or embedded lookaround are unsupported). Use a plain delimiter, "(?=...)" to split before one and keep it, or "(?<=...)" to split after one.`
    )
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

    const segments = this.regex.split(cleaned).filter((s) => s.trim().length > 0)

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
