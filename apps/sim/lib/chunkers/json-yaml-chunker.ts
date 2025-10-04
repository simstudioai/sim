import { estimateTokenCount } from '@/lib/tokenization/estimators'
import type { Chunk, ChunkerOptions } from './types'

function getTokenCount(text: string): number {
  const estimate = estimateTokenCount(text)
  return estimate.count
}

/**
 * Configuration for JSON/YAML chunking
 */
const JSON_YAML_CHUNKING_CONFIG = {
  TARGET_CHUNK_SIZE: 2000, // Target tokens per chunk
  MIN_CHUNK_SIZE: 100, // Minimum tokens per chunk
  MAX_CHUNK_SIZE: 3000, // Maximum tokens per chunk
  MAX_DEPTH_FOR_SPLITTING: 5, // Maximum depth to traverse for splitting
}

export class JsonYamlChunker {
  private chunkSize: number
  private minChunkSize: number

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = options.chunkSize || JSON_YAML_CHUNKING_CONFIG.TARGET_CHUNK_SIZE
    this.minChunkSize = options.minChunkSize || JSON_YAML_CHUNKING_CONFIG.MIN_CHUNK_SIZE
  }

  /**
   * Check if content is structured JSON/YAML data
   */
  static isStructuredData(content: string): boolean {
    try {
      JSON.parse(content)
      return true
    } catch {
      try {
        const yaml = require('js-yaml')
        yaml.load(content)
        return true
      } catch {
        return false
      }
    }
  }

  /**
   * Chunk JSON/YAML content intelligently based on structure
   */
  async chunk(content: string): Promise<Chunk[]> {
    try {
      const data = JSON.parse(content)
      return this.chunkStructuredData(data)
    } catch (error) {
      return this.chunkAsText(content)
    }
  }

  /**
   * Chunk structured data based on its structure
   */
  private chunkStructuredData(data: any, path: string[] = []): Chunk[] {
    const chunks: Chunk[] = []

    if (Array.isArray(data)) {
      return this.chunkArray(data, path)
    }

    if (typeof data === 'object' && data !== null) {
      return this.chunkObject(data, path)
    }

    const content = JSON.stringify(data, null, 2)
    const tokenCount = getTokenCount(content)

    if (tokenCount >= this.minChunkSize) {
      chunks.push({
        text: content,
        tokenCount,
        metadata: {
          startIndex: 0,
          endIndex: content.length,
        },
      })
    }

    return chunks
  }

  /**
   * Chunk an array intelligently
   */
  private chunkArray(arr: any[], path: string[]): Chunk[] {
    const chunks: Chunk[] = []
    let currentBatch: any[] = []
    let currentTokens = 0

    const contextHeader = path.length > 0 ? `// ${path.join('.')}\n` : ''

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const itemStr = JSON.stringify(item, null, 2)
      const itemTokens = getTokenCount(itemStr)

      if (itemTokens > this.chunkSize) {
        // Save current batch if it has items
        if (currentBatch.length > 0) {
          const batchContent = contextHeader + JSON.stringify(currentBatch, null, 2)
          chunks.push({
            text: batchContent,
            tokenCount: getTokenCount(batchContent),
            metadata: {
              startIndex: i - currentBatch.length,
              endIndex: i - 1,
            },
          })
          currentBatch = []
          currentTokens = 0
        }

        if (typeof item === 'object' && item !== null) {
          const subChunks = this.chunkStructuredData(item, [...path, `[${i}]`])
          chunks.push(...subChunks)
        } else {
          chunks.push({
            text: contextHeader + itemStr,
            tokenCount: itemTokens,
            metadata: {
              startIndex: i,
              endIndex: i,
            },
          })
        }
      } else if (currentTokens + itemTokens > this.chunkSize && currentBatch.length > 0) {
        const batchContent = contextHeader + JSON.stringify(currentBatch, null, 2)
        chunks.push({
          text: batchContent,
          tokenCount: currentTokens,
          metadata: {
            startIndex: i - currentBatch.length,
            endIndex: i - 1,
          },
        })
        currentBatch = [item]
        currentTokens = itemTokens
      } else {
        currentBatch.push(item)
        currentTokens += itemTokens
      }
    }

    if (currentBatch.length > 0) {
      const batchContent = contextHeader + JSON.stringify(currentBatch, null, 2)
      chunks.push({
        text: batchContent,
        tokenCount: currentTokens,
        metadata: {
          startIndex: arr.length - currentBatch.length,
          endIndex: arr.length - 1,
        },
      })
    }

    return chunks
  }

  /**
   * Chunk an object intelligently
   */
  private chunkObject(obj: Record<string, any>, path: string[]): Chunk[] {
    const chunks: Chunk[] = []
    const entries = Object.entries(obj)

    const fullContent = JSON.stringify(obj, null, 2)
    const fullTokens = getTokenCount(fullContent)

    if (fullTokens <= this.chunkSize) {
      chunks.push({
        text: fullContent,
        tokenCount: fullTokens,
        metadata: {
          startIndex: 0,
          endIndex: fullContent.length,
        },
      })
      return chunks
    }

    let currentObj: Record<string, any> = {}
    let currentTokens = 0
    let currentKeys: string[] = []

    for (const [key, value] of entries) {
      const valueStr = JSON.stringify({ [key]: value }, null, 2)
      const valueTokens = getTokenCount(valueStr)

      if (valueTokens > this.chunkSize) {
        // Save current object if it has properties
        if (Object.keys(currentObj).length > 0) {
          const objContent = JSON.stringify(currentObj, null, 2)
          chunks.push({
            text: objContent,
            tokenCount: currentTokens,
            metadata: {
              startIndex: 0,
              endIndex: objContent.length,
            },
          })
          currentObj = {}
          currentTokens = 0
          currentKeys = []
        }

        if (typeof value === 'object' && value !== null) {
          const subChunks = this.chunkStructuredData(value, [...path, key])
          chunks.push(...subChunks)
        } else {
          chunks.push({
            text: valueStr,
            tokenCount: valueTokens,
            metadata: {
              startIndex: 0,
              endIndex: valueStr.length,
            },
          })
        }
      } else if (
        currentTokens + valueTokens > this.chunkSize &&
        Object.keys(currentObj).length > 0
      ) {
        const objContent = JSON.stringify(currentObj, null, 2)
        chunks.push({
          text: objContent,
          tokenCount: currentTokens,
          metadata: {
            startIndex: 0,
            endIndex: objContent.length,
          },
        })
        currentObj = { [key]: value }
        currentTokens = valueTokens
        currentKeys = [key]
      } else {
        currentObj[key] = value
        currentTokens += valueTokens
        currentKeys.push(key)
      }
    }

    if (Object.keys(currentObj).length > 0) {
      const objContent = JSON.stringify(currentObj, null, 2)
      chunks.push({
        text: objContent,
        tokenCount: currentTokens,
        metadata: {
          startIndex: 0,
          endIndex: objContent.length,
        },
      })
    }

    return chunks
  }

  /**
   * Fall back to text chunking if JSON parsing fails.
   */
  private async chunkAsText(content: string): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    const lines = content.split('\n')
    let currentChunk = ''
    let currentTokens = 0
    let startIndex = 0

    for (const line of lines) {
      const lineTokens = getTokenCount(line)

      if (currentTokens + lineTokens > this.chunkSize && currentChunk) {
        chunks.push({
          text: currentChunk,
          tokenCount: currentTokens,
          metadata: {
            startIndex,
            endIndex: startIndex + currentChunk.length,
          },
        })

        startIndex += currentChunk.length + 1
        currentChunk = line
        currentTokens = lineTokens
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line
        currentTokens += lineTokens
      }
    }

    if (currentChunk && currentTokens >= this.minChunkSize) {
      chunks.push({
        text: currentChunk,
        tokenCount: currentTokens,
        metadata: {
          startIndex,
          endIndex: startIndex + currentChunk.length,
        },
      })
    }

    return chunks
  }

  /**
   * Static method for chunking JSON/YAML data with default options.
   */
  static async chunkJsonYaml(content: string, options: ChunkerOptions = {}): Promise<Chunk[]> {
    const chunker = new JsonYamlChunker(options)
    return chunker.chunk(content)
  }
}
