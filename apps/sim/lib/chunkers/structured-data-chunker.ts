import { createLogger } from '@sim/logger'
import type { Chunk, StructuredDataOptions } from '@/lib/chunkers/types'

/** Structured data is denser in tokens (~3 chars/token vs ~4 for prose) */
function estimateStructuredTokens(text: string): number {
  if (!text?.trim()) return 0
  return Math.ceil(text.length / 3)
}

const logger = createLogger('StructuredDataChunker')

const DEFAULT_CONFIG = {
  TARGET_CHUNK_SIZE: 1024,
  MIN_ROWS_PER_CHUNK: 5,
  MAX_ROWS_PER_CHUNK: 500,
  INCLUDE_HEADERS_IN_EACH_CHUNK: true,
} as const

export class StructuredDataChunker {
  static async chunkStructuredData(
    content: string,
    options: StructuredDataOptions = {}
  ): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    const lines = content.split('\n').filter((line) => line.trim())

    if (lines.length === 0) {
      return chunks
    }

    const targetChunkSize = options.chunkSize ?? DEFAULT_CONFIG.TARGET_CHUNK_SIZE

    const headerLine = options.headers?.join('\t') || lines[0]
    const dataStartIndex = options.headers ? 0 : 1

    const estimatedTokensPerRow = StructuredDataChunker.estimateStructuredTokensPerRow(
      lines.slice(dataStartIndex, Math.min(10, lines.length))
    )
    const optimalRowsPerChunk = StructuredDataChunker.calculateOptimalRowsPerChunk(
      estimatedTokensPerRow,
      targetChunkSize
    )

    logger.info(
      `Structured data chunking: ${lines.length} rows, ~${estimatedTokensPerRow} tokens/row, ${optimalRowsPerChunk} rows/chunk, target: ${targetChunkSize} tokens`
    )

    let currentChunkRows: string[] = []
    let currentTokenEstimate = 0
    const headerTokens = estimateStructuredTokens(headerLine)
    let chunkStartRow = dataStartIndex

    for (let i = dataStartIndex; i < lines.length; i++) {
      const row = lines[i]
      const rowTokens = estimateStructuredTokens(row)

      const projectedTokens =
        currentTokenEstimate +
        rowTokens +
        (DEFAULT_CONFIG.INCLUDE_HEADERS_IN_EACH_CHUNK ? headerTokens : 0)

      const shouldCreateChunk =
        (projectedTokens > targetChunkSize &&
          currentChunkRows.length >= DEFAULT_CONFIG.MIN_ROWS_PER_CHUNK) ||
        currentChunkRows.length >= optimalRowsPerChunk

      if (shouldCreateChunk && currentChunkRows.length > 0) {
        const chunkContent = StructuredDataChunker.formatChunk(
          headerLine,
          currentChunkRows,
          options.sheetName
        )
        chunks.push(StructuredDataChunker.createChunk(chunkContent, chunkStartRow, i - 1))

        currentChunkRows = []
        currentTokenEstimate = 0
        chunkStartRow = i
      }

      currentChunkRows.push(row)
      currentTokenEstimate += rowTokens
    }

    if (currentChunkRows.length > 0) {
      const chunkContent = StructuredDataChunker.formatChunk(
        headerLine,
        currentChunkRows,
        options.sheetName
      )
      chunks.push(StructuredDataChunker.createChunk(chunkContent, chunkStartRow, lines.length - 1))
    }

    logger.info(`Created ${chunks.length} chunks from ${lines.length} rows of structured data`)

    return chunks
  }

  private static formatChunk(headerLine: string, rows: string[], sheetName?: string): string {
    let content = ''

    if (sheetName) {
      content += `=== ${sheetName} ===\n\n`
    }

    if (DEFAULT_CONFIG.INCLUDE_HEADERS_IN_EACH_CHUNK) {
      content += `Headers: ${headerLine}\n`
      content += `${'-'.repeat(Math.min(80, headerLine.length))}\n`
    }

    content += rows.join('\n')
    content += `\n\n[${rows.length} rows of data]`

    return content
  }

  private static createChunk(content: string, startRow: number, endRow: number): Chunk {
    return {
      text: content,
      tokenCount: estimateStructuredTokens(content),
      metadata: {
        startIndex: startRow,
        endIndex: endRow,
      },
    }
  }

  private static estimateStructuredTokensPerRow(sampleRows: string[]): number {
    if (sampleRows.length === 0) return 50

    const totalTokens = sampleRows.reduce((sum, row) => sum + estimateStructuredTokens(row), 0)
    return Math.ceil(totalTokens / sampleRows.length)
  }

  private static calculateOptimalRowsPerChunk(
    tokensPerRow: number,
    targetChunkSize: number
  ): number {
    const optimal = Math.floor(targetChunkSize / tokensPerRow)

    return Math.min(
      Math.max(optimal, DEFAULT_CONFIG.MIN_ROWS_PER_CHUNK),
      DEFAULT_CONFIG.MAX_ROWS_PER_CHUNK
    )
  }

  static isStructuredData(content: string, mimeType?: string): boolean {
    if (mimeType) {
      const structuredMimeTypes = [
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/tab-separated-values',
      ]
      if (structuredMimeTypes.includes(mimeType)) {
        return true
      }
    }

    const lines = content.split('\n').slice(0, 10)
    if (lines.length < 2) return false

    const delimiters = [',', '\t', '|']
    for (const delimiter of delimiters) {
      const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const counts = lines.map((line) => (line.match(new RegExp(escaped, 'g')) || []).length)
      const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length

      const tolerance = Math.max(1, Math.ceil(avgCount * 0.2))
      if (avgCount > 2 && counts.every((c) => Math.abs(c - avgCount) <= tolerance)) {
        return true
      }
    }

    return false
  }
}
