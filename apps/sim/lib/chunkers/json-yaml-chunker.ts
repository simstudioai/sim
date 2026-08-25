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

const logger = createLogger('JsonYamlChunker')

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]
type BoundedChunkMetadataMode = 'text-offsets' | 'preserve-range'

const MAX_DEPTH = 5

export class JsonYamlChunker {
  private chunkSize: number
  private minCharactersPerChunk: number
  private maxChunks?: number

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = normalizeTokenChunkSize(options.chunkSize ?? 1024, 'JSON/YAML chunk size')
    this.minCharactersPerChunk = options.minCharactersPerChunk ?? 100
    this.maxChunks = options.maxChunks
  }

  static isStructuredData(content: string): boolean {
    try {
      const parsed = JSON.parse(content)
      return typeof parsed === 'object' && parsed !== null
    } catch {
      try {
        const parsed = yaml.load(content)
        return typeof parsed === 'object' && parsed !== null
      } catch {
        return false
      }
    }
  }

  async chunk(content: string): Promise<Chunk[]> {
    try {
      let data: JsonValue
      try {
        data = JSON.parse(content) as JsonValue
      } catch {
        data = yaml.load(content) as JsonValue
      }

      const chunks: Chunk[] = []
      this.chunkStructuredData(data, [], 0, chunks, new ChunkBudget(this.maxChunks))

      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
      logger.info(`JSON chunking complete: ${chunks.length} chunks, ${totalTokens} total tokens`)

      return chunks
    } catch (error) {
      if (error instanceof ChunkLimitExceededError) throw error
      logger.info('Structured data chunking failed, falling back to text chunking')
      return this.chunkAsText(content, new ChunkBudget(this.maxChunks))
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

  private chunkAsText(content: string, budget: ChunkBudget, chunks: Chunk[] = []): Chunk[] {
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

  static async chunkJsonYaml(content: string, options: ChunkerOptions = {}): Promise<Chunk[]> {
    const chunker = new JsonYamlChunker(options)
    return chunker.chunk(content)
  }
}
