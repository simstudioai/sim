import { createLogger } from '@sim/logger'
import * as yaml from 'js-yaml'
import { ChunkBudget, ChunkLimitExceededError } from '@/lib/chunkers/chunk-budget'
import type { Chunk, ChunkerOptions } from '@/lib/chunkers/types'
import {
  estimateTokens,
  iterateLines,
  iterateLosslessWordBoundaryChunkSpans,
  normalizeTokenChunkSize,
  tokensToChars,
} from '@/lib/chunkers/utils'
import { measureYamlExpansion, type YamlExpansionLimits } from '@/lib/file-parsers/yaml-limits'
import { FILE_PARSER_YAML_LIMITS } from '@/lib/file-parsers/yaml-parser'

const logger = createLogger('JsonYamlChunker')

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]
type BoundedChunkMetadataMode = 'text-offsets' | 'preserve-range'

const MAX_DEPTH = 5

/**
 * Smallest expansion ceiling this chunker imposes, so a knowledge base
 * configured with tiny chunks keeps structural chunking on documents it indexes
 * perfectly well today.
 */
const MIN_EXPANSION_BYTES = 4 * 1024 * 1024

/**
 * How large an expanded document this chunker will materialize.
 *
 * Structural chunking re-serializes what it parsed, so its cost follows the
 * document's *expanded* size rather than its source size, and `yaml.load`
 * resolves aliases into shared references — a sub-kilobyte source can carry tens
 * of megabytes of expansion. `ChunkBudget` cannot bound that: it counts emitted
 * chunks, and every parse and serialization happens before the first is emitted.
 *
 * The ceiling is the most text this chunker could ever emit, one output budget's
 * worth, because a larger document cannot be indexed whole by any chunker and
 * paying to expand it buys nothing. Transient allocation therefore stays the
 * same order as the output, and every document that fits the budget is chunked
 * exactly as before.
 */
function resolveExpansionLimits(
  maxChunks: number | undefined,
  chunkSize: number
): YamlExpansionLimits {
  const emittable =
    maxChunks === undefined
      ? FILE_PARSER_YAML_LIMITS.maxSerializedBytes
      : maxChunks * tokensToChars(chunkSize)

  return {
    /** Bytes bind here; every reached node charges some, so a self-referential anchor still terminates. */
    maxNodes: Number.MAX_SAFE_INTEGER,
    maxSerializedBytes: Math.min(
      FILE_PARSER_YAML_LIMITS.maxSerializedBytes,
      Math.max(MIN_EXPANSION_BYTES, emittable)
    ),
    maxDepth: FILE_PARSER_YAML_LIMITS.maxDepth,
  }
}

export class JsonYamlChunker {
  private chunkSize: number
  private minCharactersPerChunk: number
  private maxChunks?: number
  private readonly expansionLimits: YamlExpansionLimits

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = normalizeTokenChunkSize(options.chunkSize ?? 1024, 'JSON/YAML chunk size')
    this.minCharactersPerChunk = options.minCharactersPerChunk ?? 100
    this.maxChunks = options.maxChunks
    this.expansionLimits = resolveExpansionLimits(this.maxChunks, this.chunkSize)
  }

  /**
   * Read `content` as JSON, falling back to YAML, and measure what the parsed
   * value expands to before anything materializes it.
   *
   * The source-length check comes first so oversized content is never parsed at
   * all; the expansion measurement then catches what length alone cannot — alias
   * expansion, and the indentation a pretty-printed re-serialization adds.
   */
  private parseWithinLimits(content: string): JsonValue | undefined {
    if (content.length > this.expansionLimits.maxSerializedBytes) {
      return this.reject(
        `source of ${content.length} characters exceeds the ${this.expansionLimits.maxSerializedBytes}-byte ceiling`
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      try {
        parsed = yaml.load(content)
      } catch {
        return undefined
      }
    }

    if (parsed === undefined) return undefined

    const measured = measureYamlExpansion(parsed, this.expansionLimits)
    if (!measured.within) return this.reject(measured.reason)

    return parsed as JsonValue
  }

  private reject(reason: string): undefined {
    logger.warn(
      'Structured content exceeds the chunking expansion limits, declining to expand it',
      {
        reason,
      }
    )
    return undefined
  }

  /**
   * Chunk `content` as a structured object or array, or return `null` when it is
   * neither — including when its expanded form outgrows the ceiling above. The
   * caller then chooses another chunker for it.
   */
  static async chunkStructured(
    content: string,
    options: ChunkerOptions = {}
  ): Promise<Chunk[] | null> {
    const chunker = new JsonYamlChunker(options)
    const data = chunker.parseWithinLimits(content)
    if (data === null || typeof data !== 'object') return null

    return chunker.chunkParsed(data, content)
  }

  async chunk(content: string): Promise<Chunk[]> {
    const data = this.parseWithinLimits(content)
    if (data === undefined) return this.chunkAsText(content)

    return this.chunkParsed(data, content)
  }

  private chunkParsed(data: JsonValue, content: string): Chunk[] {
    try {
      const chunks: Chunk[] = []
      this.chunkStructuredData(data, [], 0, chunks, new ChunkBudget(this.maxChunks))

      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
      logger.info(`JSON chunking complete: ${chunks.length} chunks, ${totalTokens} total tokens`)

      return chunks
    } catch (error) {
      if (error instanceof ChunkLimitExceededError) throw error
      logger.info('Structured data chunking failed, falling back to text chunking')
      return this.chunkAsText(content)
    }
  }

  private chunkStructuredData(
    data: JsonValue,
    path: string[],
    depth: number,
    chunks: Chunk[],
    budget: ChunkBudget
  ): void {
    if (Array.isArray(data)) {
      this.chunkArray(data, path, depth, chunks, budget)
      return
    }

    if (typeof data === 'object' && data !== null) {
      this.chunkObject(data as JsonObject, path, depth, chunks, budget)
      return
    }

    const content = JSON.stringify(data, null, 2)
    const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''
    const contentTokens = estimateTokens(content)

    if (contentTokens > this.chunkSize) {
      this.chunkAsText(contextHeader + content, budget, chunks)
      return
    }

    if (content.length < this.minCharactersPerChunk) {
      return
    }

    const text = contextHeader + content
    this.addBoundedChunk(chunks, budget, {
      text,
      tokenCount: estimateTokens(text),
      metadata: { startIndex: 0, endIndex: text.length },
    })
  }

  private chunkArray(
    arr: JsonArray,
    path: string[],
    depth: number,
    chunks: Chunk[],
    budget: ChunkBudget
  ): void {
    let currentBatch: JsonValue[] = []
    let currentTokens = 0

    const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const itemStr = JSON.stringify(item, null, 2)
      const itemTokens = estimateTokens(itemStr)

      if (itemTokens > this.chunkSize) {
        if (currentBatch.length > 0) {
          this.addBoundedChunk(
            chunks,
            budget,
            this.buildBatchChunk(contextHeader, currentBatch, i - currentBatch.length, i - 1),
            'preserve-range'
          )
          currentBatch = []
          currentTokens = 0
        }

        if (depth < MAX_DEPTH && typeof item === 'object' && item !== null) {
          this.chunkStructuredData(item, [...path, `[${i}]`], depth + 1, chunks, budget)
        } else {
          const text = contextHeader + itemStr
          this.addBoundedChunk(
            chunks,
            budget,
            {
              text,
              tokenCount: estimateTokens(text),
              metadata: { startIndex: i, endIndex: i },
            },
            'preserve-range'
          )
        }
      } else if (currentTokens + itemTokens > this.chunkSize && currentBatch.length > 0) {
        this.addBoundedChunk(
          chunks,
          budget,
          this.buildBatchChunk(contextHeader, currentBatch, i - currentBatch.length, i - 1),
          'preserve-range'
        )
        currentBatch = [item]
        currentTokens = itemTokens
      } else {
        currentBatch.push(item)
        currentTokens += itemTokens
      }
    }

    if (currentBatch.length > 0) {
      this.addBoundedChunk(
        chunks,
        budget,
        this.buildBatchChunk(
          contextHeader,
          currentBatch,
          arr.length - currentBatch.length,
          arr.length - 1
        ),
        'preserve-range'
      )
    }
  }

  private chunkObject(
    obj: JsonObject,
    path: string[],
    depth: number,
    chunks: Chunk[],
    budget: ChunkBudget
  ): void {
    const entries = Object.entries(obj)

    const fullContent = JSON.stringify(obj, null, 2)
    const fullTokens = estimateTokens(fullContent)

    if (fullTokens <= this.chunkSize) {
      const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''
      const text = contextHeader + fullContent
      this.addBoundedChunk(chunks, budget, {
        text,
        tokenCount: estimateTokens(text),
        metadata: { startIndex: 0, endIndex: text.length },
      })
      return
    }

    const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''
    let currentObj: JsonObject = {}
    let currentTokens = 0

    for (const [key, value] of entries) {
      const valueStr = JSON.stringify({ [key]: value }, null, 2)
      const valueTokens = estimateTokens(valueStr)

      if (valueTokens > this.chunkSize) {
        if (Object.keys(currentObj).length > 0) {
          const objContent = contextHeader + JSON.stringify(currentObj, null, 2)
          this.addBoundedChunk(chunks, budget, {
            text: objContent,
            tokenCount: estimateTokens(objContent),
            metadata: { startIndex: 0, endIndex: objContent.length },
          })
          currentObj = {}
          currentTokens = 0
        }

        if (depth < MAX_DEPTH && typeof value === 'object' && value !== null) {
          this.chunkStructuredData(value, [...path, key], depth + 1, chunks, budget)
        } else {
          this.chunkAsText(contextHeader + valueStr, budget, chunks)
        }
      } else if (
        currentTokens + valueTokens > this.chunkSize &&
        Object.keys(currentObj).length > 0
      ) {
        const objContent = contextHeader + JSON.stringify(currentObj, null, 2)
        this.addBoundedChunk(chunks, budget, {
          text: objContent,
          tokenCount: estimateTokens(objContent),
          metadata: { startIndex: 0, endIndex: objContent.length },
        })
        currentObj = { [key]: value }
        currentTokens = valueTokens
      } else {
        currentObj[key] = value
        currentTokens += valueTokens
      }
    }

    if (Object.keys(currentObj).length > 0) {
      const objContent = contextHeader + JSON.stringify(currentObj, null, 2)
      this.addBoundedChunk(chunks, budget, {
        text: objContent,
        tokenCount: estimateTokens(objContent),
        metadata: { startIndex: 0, endIndex: objContent.length },
      })
    }
  }

  private buildBatchChunk(
    contextHeader: string,
    batch: JsonValue[],
    startIdx: number,
    endIdx: number
  ): Chunk {
    const batchContent = contextHeader + JSON.stringify(batch, null, 2)
    return {
      text: batchContent,
      tokenCount: estimateTokens(batchContent),
      metadata: { startIndex: startIdx, endIndex: endIdx },
    }
  }

  private addBoundedChunk(
    chunks: Chunk[],
    budget: ChunkBudget,
    chunk: Chunk,
    metadataMode: BoundedChunkMetadataMode = 'text-offsets'
  ): void {
    if (chunk.tokenCount <= this.chunkSize) {
      budget.add(chunks, chunk)
      return
    }

    for (const segment of iterateLosslessWordBoundaryChunkSpans(
      chunk.text,
      tokensToChars(this.chunkSize)
    )) {
      budget.add(chunks, {
        text: segment.text,
        tokenCount: estimateTokens(segment.text),
        metadata:
          metadataMode === 'preserve-range'
            ? chunk.metadata
            : {
                startIndex: chunk.metadata.startIndex + segment.startIndex,
                endIndex: chunk.metadata.startIndex + segment.endIndex,
              },
      })
    }
  }

  private chunkAsText(
    content: string,
    budget: ChunkBudget = new ChunkBudget(this.maxChunks),
    chunks: Chunk[] = []
  ): Chunk[] {
    let currentChunk = ''
    let currentTokens = 0
    let startIndex = 0

    for (const line of iterateLines(content)) {
      const lineTokens = estimateTokens(line)

      if (lineTokens > this.chunkSize) {
        if (currentChunk) {
          budget.add(chunks, {
            text: currentChunk,
            tokenCount: currentTokens,
            metadata: { startIndex, endIndex: startIndex + currentChunk.length },
          })
          startIndex += currentChunk.length + 1
          currentChunk = ''
          currentTokens = 0
        }
        const lineStartIndex = startIndex
        for (const segment of iterateLosslessWordBoundaryChunkSpans(
          line,
          tokensToChars(this.chunkSize)
        )) {
          budget.add(chunks, {
            text: segment.text,
            tokenCount: estimateTokens(segment.text),
            metadata: {
              startIndex: lineStartIndex + segment.startIndex,
              endIndex: lineStartIndex + segment.endIndex,
            },
          })
        }
        startIndex += line.length + 1
        continue
      }

      if (currentTokens + lineTokens > this.chunkSize && currentChunk) {
        budget.add(chunks, {
          text: currentChunk,
          tokenCount: currentTokens,
          metadata: { startIndex, endIndex: startIndex + currentChunk.length },
        })

        startIndex += currentChunk.length + 1
        currentChunk = line
        currentTokens = lineTokens
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line
        currentTokens += lineTokens
      }
    }

    if (currentChunk && currentChunk.length >= this.minCharactersPerChunk) {
      budget.add(chunks, {
        text: currentChunk,
        tokenCount: currentTokens,
        metadata: { startIndex, endIndex: startIndex + currentChunk.length },
      })
    }

    return chunks
  }
}
