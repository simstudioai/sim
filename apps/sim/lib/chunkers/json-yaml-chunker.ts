import { createLogger } from '@sim/logger'
import * as yaml from 'js-yaml'
import type { Chunk, ChunkerOptions } from '@/lib/chunkers/types'
import { estimateTokens } from '@/lib/chunkers/utils'

const logger = createLogger('JsonYamlChunker')

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonArray
type JsonObject = { [key: string]: JsonValue }
type JsonArray = JsonValue[]

const MAX_DEPTH = 5

export class JsonYamlChunker {
  private chunkSize: number
  private minCharactersPerChunk: number

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1024
    this.minCharactersPerChunk = options.minCharactersPerChunk ?? 100
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
      const chunks = this.chunkStructuredData(data, [], 0)

      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0)
      logger.info(`JSON chunking complete: ${chunks.length} chunks, ${totalTokens} total tokens`)

      return chunks
    } catch (error) {
      logger.info('JSON parsing failed, falling back to text chunking')
      return this.chunkAsText(content)
    }
  }

  private chunkStructuredData(data: JsonValue, path: string[], depth: number): Chunk[] {
    if (Array.isArray(data)) {
      return this.chunkArray(data, path, depth)
    }

    if (typeof data === 'object' && data !== null) {
      return this.chunkObject(data as JsonObject, path, depth)
    }

    const content = JSON.stringify(data, null, 2)
    const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''
    const contentTokens = estimateTokens(content)

    if (contentTokens > this.chunkSize) {
      return this.chunkAsText(contextHeader + content)
    }

    if (content.length < this.minCharactersPerChunk) {
      return []
    }

    const text = contextHeader + content
    return [
      {
        text,
        tokenCount: estimateTokens(text),
        metadata: { startIndex: 0, endIndex: text.length },
      },
    ]
  }

  private chunkArray(arr: JsonArray, path: string[], depth: number): Chunk[] {
    const chunks: Chunk[] = []
    let currentBatch: JsonValue[] = []
    let currentTokens = 0

    const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const itemStr = JSON.stringify(item, null, 2)
      const itemTokens = estimateTokens(itemStr)

      if (itemTokens > this.chunkSize) {
        if (currentBatch.length > 0) {
          chunks.push(
            this.buildBatchChunk(contextHeader, currentBatch, i - currentBatch.length, i - 1)
          )
          currentBatch = []
          currentTokens = 0
        }

        if (depth < MAX_DEPTH && typeof item === 'object' && item !== null) {
          chunks.push(...this.chunkStructuredData(item, [...path, `[${i}]`], depth + 1))
        } else {
          chunks.push({
            text: contextHeader + itemStr,
            tokenCount: itemTokens,
            metadata: { startIndex: i, endIndex: i },
          })
        }
      } else if (currentTokens + itemTokens > this.chunkSize && currentBatch.length > 0) {
        chunks.push(
          this.buildBatchChunk(contextHeader, currentBatch, i - currentBatch.length, i - 1)
        )
        currentBatch = [item]
        currentTokens = itemTokens
      } else {
        currentBatch.push(item)
        currentTokens += itemTokens
      }
    }

    if (currentBatch.length > 0) {
      chunks.push(
        this.buildBatchChunk(
          contextHeader,
          currentBatch,
          arr.length - currentBatch.length,
          arr.length - 1
        )
      )
    }

    return chunks
  }

  private chunkObject(obj: JsonObject, path: string[], depth: number): Chunk[] {
    const chunks: Chunk[] = []
    const entries = Object.entries(obj)

    const fullContent = JSON.stringify(obj, null, 2)
    const fullTokens = estimateTokens(fullContent)

    if (fullTokens <= this.chunkSize) {
      const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''
      const text = contextHeader + fullContent
      return [
        {
          text,
          tokenCount: estimateTokens(text),
          metadata: { startIndex: 0, endIndex: text.length },
        },
      ]
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
          chunks.push({
            text: objContent,
            tokenCount: estimateTokens(objContent),
            metadata: { startIndex: 0, endIndex: objContent.length },
          })
          currentObj = {}
          currentTokens = 0
        }

        if (depth < MAX_DEPTH && typeof value === 'object' && value !== null) {
          chunks.push(...this.chunkStructuredData(value, [...path, key], depth + 1))
        } else {
          chunks.push({
            text: contextHeader + valueStr,
            tokenCount: valueTokens,
            metadata: { startIndex: 0, endIndex: valueStr.length },
          })
        }
      } else if (
        currentTokens + valueTokens > this.chunkSize &&
        Object.keys(currentObj).length > 0
      ) {
        const objContent = contextHeader + JSON.stringify(currentObj, null, 2)
        chunks.push({
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
      chunks.push({
        text: objContent,
        tokenCount: estimateTokens(objContent),
        metadata: { startIndex: 0, endIndex: objContent.length },
      })
    }

    return chunks
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

  private chunkAsText(content: string): Chunk[] {
    const chunks: Chunk[] = []
    const lines = content.split('\n')
    let currentChunk = ''
    let currentTokens = 0
    let startIndex = 0

    for (const line of lines) {
      const lineTokens = estimateTokens(line)

      if (currentTokens + lineTokens > this.chunkSize && currentChunk) {
        chunks.push({
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
      chunks.push({
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
