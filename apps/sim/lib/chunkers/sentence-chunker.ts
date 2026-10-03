import { createLogger } from '@sim/logger'
import { ChunkBudget } from '@/lib/chunkers/chunk-budget'
import type { Chunk, SentenceChunkerOptions } from '@/lib/chunkers/types'
import {
  buildChunks,
  cleanText,
  estimateTokens,
  iterateWordBoundaryChunks,
  resolveChunkerOptions,
  tokensToChars,
} from '@/lib/chunkers/utils'

const logger = createLogger('SentenceChunker')

const SENTENCE_BOUNDARY_PATTERN =
  /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Rev|Gen|Sgt|Capt|Lt|Col|Maj|No|Fig|Vol|Ch|vs|etc|Inc|Ltd|Corp|Co|approx|dept|est|govt|Ave|Blvd|Rd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|i\.e|e\.g)\.)(?<![A-Z]\.)(?<!\.\.)(?<!\d\.)(?<=[.!?])\s+/g

/** Never splits mid-sentence unless a single sentence exceeds the limit. */
export class SentenceChunker {
  private readonly chunkSize: number
  private readonly chunkOverlap: number
  private readonly minSentencesPerChunk: number
  private readonly maxChunks?: number

  constructor(options: SentenceChunkerOptions = {}) {
    const resolved = resolveChunkerOptions(options)
    this.chunkSize = resolved.chunkSize
    this.chunkOverlap = resolved.chunkOverlap
    this.minSentencesPerChunk = options.minSentencesPerChunk ?? 1
    this.maxChunks = options.maxChunks
  }

  /** Splits on sentence boundaries while avoiding abbreviations, decimals, and ellipses. */
  private *splitSentences(text: string): Generator<string> {
    let cursor = 0
    for (const match of text.matchAll(SENTENCE_BOUNDARY_PATTERN)) {
      const sentence = text.slice(cursor, match.index)
      if (sentence.trim()) yield sentence
      cursor = match.index + match[0].length
    }
    const tail = text.slice(cursor)
    if (tail.trim()) yield tail
  }

  async chunk(content: string): Promise<Chunk[]> {
    if (!content?.trim()) {
      return []
    }

    const cleaned = cleanText(content)

    if (estimateTokens(cleaned) <= this.chunkSize) {
      logger.info('Content fits in single chunk')
      const texts: string[] = []
      new ChunkBudget(this.maxChunks).add(texts, cleaned)
      return buildChunks(texts, 0)
    }

    const budget = new ChunkBudget(this.maxChunks)
    const chunkSentenceGroups: string[][] = []
    let currentGroup: string[] = []
    let currentTokens = 0
    const chunkSizeChars = tokensToChars(this.chunkSize)

    for (const sentence of this.splitSentences(cleaned)) {
      const sentenceTokens = estimateTokens(sentence)

      if (sentenceTokens > this.chunkSize) {
        if (currentGroup.length > 0) {
          budget.add(chunkSentenceGroups, currentGroup)
          currentGroup = []
          currentTokens = 0
        }
        for (const part of iterateWordBoundaryChunks(sentence, chunkSizeChars)) {
          budget.add(chunkSentenceGroups, [part])
        }
        continue
      }

      const wouldExceed = currentTokens + sentenceTokens > this.chunkSize
      const hasMinSentences = currentGroup.length >= this.minSentencesPerChunk

      if (wouldExceed && hasMinSentences) {
        budget.add(chunkSentenceGroups, currentGroup)
        currentGroup = [sentence]
        currentTokens = sentenceTokens
      } else {
        currentGroup.push(sentence)
        currentTokens += sentenceTokens
      }
    }

    if (currentGroup.length > 0) {
      budget.add(chunkSentenceGroups, currentGroup)
    }

    const rawChunks = this.applyOverlapFromGroups(chunkSentenceGroups)

    logger.info(`Chunked into ${rawChunks.length} sentence-based chunks`)
    return buildChunks(rawChunks, this.chunkOverlap)
  }

  /** Applies overlap at the sentence level using original groups to avoid re-splitting. */
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

      const currentText = groups[i].join(' ')
      if (overlapSentences.length > 0) {
        result.push(`${overlapSentences.join(' ')} ${currentText}`)
      } else {
        // No complete sentence fits — fall back to character-level overlap
        const prevText = prevGroup.join(' ')
        const tail = prevText.slice(-overlapChars)
        const wordMatch = tail.match(/^\s*\S/)
        const cleanTail = wordMatch ? tail.slice(tail.indexOf(wordMatch[0].trim())) : tail
        if (cleanTail.trim()) {
          result.push(`${cleanTail.trim()} ${currentText}`)
        } else {
          result.push(currentText)
        }
      }
    }

    return result
  }
}
