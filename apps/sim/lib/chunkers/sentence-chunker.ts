import { createLogger } from '@sim/logger'
import type { Chunk, SentenceChunkerOptions } from '@/lib/chunkers/types'
import {
  buildChunks,
  cleanText,
  estimateTokens,
  resolveChunkerOptions,
  splitAtWordBoundaries,
  tokensToChars,
} from '@/lib/chunkers/utils'

const logger = createLogger('SentenceChunker')

/**
 * Sentence-based chunker
 * Groups complete sentences into chunks up to the token limit.
 * Never splits mid-sentence unless a single sentence exceeds the limit.
 */
export class SentenceChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly minSentencesPerChunk: number

  constructor(options: SentenceChunkerOptions = {}) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.minSentencesPerChunk = options.minSentencesPerChunk ?? 1
  }

  /**
   * Split text into sentences using a regex that avoids common false positives
   * like abbreviations (Mr., Dr., U.S.), decimals (3.14), and ellipses (...).
   */
  private splitSentences(text: string): string[] {
    return text
      .split(/(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Rev|Gen|Sgt|No|Fig|Vol|Ch|vs|etc|Inc|Ltd|Corp|approx|dept|est|govt|Jan|Feb|Mar|Apr|Aug|Sep|Oct|Nov|Dec|i\.e|e\.g))(?<![A-Z])(?<!\.\.)(?<!\d)(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 0)
  }

  async chunk(content: string): Promise<Chunk[]> {
    if (!content?.trim()) {
      return []
    }

    const cleaned = cleanText(content)
    const sentences = this.splitSentences(cleaned)

    if (sentences.length === 0) {
      return []
    }

    if (estimateTokens(cleaned) <= this.chunkSize) {
      logger.info('Content fits in single chunk')
      return buildChunks([cleaned], 0)
    }

    const chunkSentenceGroups: string[][] = []
    let currentGroup: string[] = []
    let currentTokens = 0
    const chunkSizeChars = tokensToChars(this.chunkSize)

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence)

      if (sentenceTokens > this.chunkSize) {
        if (currentGroup.length > 0) {
          chunkSentenceGroups.push(currentGroup)
          currentGroup = []
          currentTokens = 0
        }
        const parts = splitAtWordBoundaries(sentence, chunkSizeChars)
        for (const part of parts) {
          chunkSentenceGroups.push([part])
        }
        continue
      }

      const wouldExceed = currentTokens + sentenceTokens > this.chunkSize
      const hasMinSentences = currentGroup.length >= this.minSentencesPerChunk

      if (wouldExceed && hasMinSentences) {
        chunkSentenceGroups.push(currentGroup)
        currentGroup = [sentence]
        currentTokens = sentenceTokens
      } else {
        currentGroup.push(sentence)
        currentTokens += sentenceTokens
      }
    }

    if (currentGroup.length > 0) {
      chunkSentenceGroups.push(currentGroup)
    }

    const rawChunks = this.applyOverlapFromGroups(chunkSentenceGroups)

    logger.info(`Chunked into ${rawChunks.length} sentence-based chunks`)
    return buildChunks(rawChunks, this.chunkOverlap)
  }

  /**
   * Apply sentence-level overlap using the original sentence groups,
   * avoiding re-splitting joined text back into sentences.
   */
  private applyOverlapFromGroups(groups: string[][]): string[] {
    if (this.chunkOverlap <= 0 || groups.length <= 1) {
      return groups.map((g) => g.join(' '))
    }

    const overlapChars = tokensToChars(this.chunkOverlap)
    const result: string[] = []

    for (let i = 0; i < groups.length; i++) {
      if (i === 0) {
        result.push(groups[i].join(' '))
        continue
      }

      const prevGroup = groups[i - 1]
      const overlapSentences: string[] = []
      let overlapLen = 0

      for (let j = prevGroup.length - 1; j >= 0; j--) {
        if (overlapLen + prevGroup[j].length > overlapChars) break
        overlapSentences.unshift(prevGroup[j])
        overlapLen += prevGroup[j].length
      }

      if (overlapSentences.length > 0) {
        result.push(`${overlapSentences.join(' ')} ${groups[i].join(' ')}`)
      } else {
        result.push(groups[i].join(' '))
      }
    }

    return result
  }
}
