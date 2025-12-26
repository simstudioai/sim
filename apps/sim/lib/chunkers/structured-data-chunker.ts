import { createLogger } from '@sim/logger'
import type { Chunk, StructuredDataOptions } from '@/lib/chunkers/types'

const logger = createLogger('StructuredDataChunker')

/**
 * Default configuration for structured data chunking (CSV, XLSX, etc.)
 * These are used when user doesn't provide preferences
 */
const DEFAULT_CONFIG = {
  // Target chunk size in tokens
  TARGET_CHUNK_SIZE: 1024,
  MIN_CHUNK_SIZE: 100,
  MAX_CHUNK_SIZE: 4000,

  // For spreadsheets, group rows together
  ROWS_PER_CHUNK: 100,
  MIN_ROWS_PER_CHUNK: 20,
  MAX_ROWS_PER_CHUNK: 500,

  // For better embeddings quality
  INCLUDE_HEADERS_IN_EACH_CHUNK: true,
  MAX_HEADER_SIZE: 200, // tokens
}

/**
 * Smart chunker for structured data (CSV, XLSX) that preserves semantic meaning
 * Preserves headers in each chunk for better semantic context
 */
export class StructuredDataChunker {
  /**
   * Chunk structured data intelligently based on rows and semantic boundaries
   * Respects user's chunkSize preference when provided
   */
  static async chunkStructuredData(
    content: string,
    options: StructuredDataOptions = {}
  ): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    const lines = content.split('\n').filter((line) => line.trim())

    if (lines.length === 0) {
      return chunks
    }

    // Use user's chunk size or fall back to default
    const targetChunkSize = options.chunkSize ?? DEFAULT_CONFIG.TARGET_CHUNK_SIZE

    // Detect headers (first line or provided)
    const headerLine = options.headers?.join('\t') || lines[0]
    const dataStartIndex = options.headers ? 0 : 1

    // Calculate optimal rows per chunk based on content and user's target size
    const estimatedTokensPerRow = StructuredDataChunker.estimateTokensPerRow(
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
    const headerTokens = StructuredDataChunker.estimateTokens(headerLine)
    let chunkStartRow = dataStartIndex

    for (let i = dataStartIndex; i < lines.length; i++) {
      const row = lines[i]
      const rowTokens = StructuredDataChunker.estimateTokens(row)

      // Check if adding this row would exceed our target
      const projectedTokens =
        currentTokenEstimate +
        rowTokens +
        (DEFAULT_CONFIG.INCLUDE_HEADERS_IN_EACH_CHUNK ? headerTokens : 0)

      const shouldCreateChunk =
        (projectedTokens > targetChunkSize &&
          currentChunkRows.length >= DEFAULT_CONFIG.MIN_ROWS_PER_CHUNK) ||
        currentChunkRows.length >= optimalRowsPerChunk

      if (shouldCreateChunk && currentChunkRows.length > 0) {
        // Create chunk with current rows
        const chunkContent = StructuredDataChunker.formatChunk(
          headerLine,
          currentChunkRows,
          options.sheetName
        )
        chunks.push(StructuredDataChunker.createChunk(chunkContent, chunkStartRow, i - 1))

        // Reset for next chunk
        currentChunkRows = []
        currentTokenEstimate = 0
        chunkStartRow = i
      }

      currentChunkRows.push(row)
      currentTokenEstimate += rowTokens
    }

    // Add remaining rows as final chunk
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

  /**
   * Format a chunk with headers and context
   */
  private static formatChunk(headerLine: string, rows: string[], sheetName?: string): string {
    let content = ''

    // Add sheet name context if available
    if (sheetName) {
      content += `=== ${sheetName} ===\n\n`
    }

    // Add headers for context
    if (DEFAULT_CONFIG.INCLUDE_HEADERS_IN_EACH_CHUNK) {
      content += `Headers: ${headerLine}\n`
      content += `${'-'.repeat(Math.min(80, headerLine.length))}\n`
    }

    // Add data rows
    content += rows.join('\n')

    // Add row count for context
    content += `\n\n[Rows ${rows.length} of data]`

    return content
  }

  /**
   * Create a chunk object with actual row indices
   */
  private static createChunk(content: string, startRow: number, endRow: number): Chunk {
    const tokenCount = StructuredDataChunker.estimateTokens(content)

    return {
      text: content,
      tokenCount,
      metadata: {
        startIndex: startRow,
        endIndex: endRow,
      },
    }
  }

  /**
   * Estimate tokens in text (rough approximation)
   * For structured data with numbers, uses 1 token per 3 characters
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 3)
  }

  /**
   * Estimate average tokens per row from sample
   */
  private static estimateTokensPerRow(sampleRows: string[]): number {
    if (sampleRows.length === 0) return 50 // default estimate

    const totalTokens = sampleRows.reduce(
      (sum, row) => sum + StructuredDataChunker.estimateTokens(row),
      0
    )
    return Math.ceil(totalTokens / sampleRows.length)
  }

  /**
   * Calculate optimal rows per chunk based on token estimates and target size
   */
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

  /**
   * Check if content appears to be structured data
   */
  static isStructuredData(content: string, mimeType?: string): boolean {
    // Check mime type first
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

    // Check content structure
    const lines = content.split('\n').slice(0, 10) // Check first 10 lines
    if (lines.length < 2) return false

    // Check for consistent delimiters (comma, tab, pipe)
    const delimiters = [',', '\t', '|']
    for (const delimiter of delimiters) {
      const counts = lines.map(
        (line) => (line.match(new RegExp(`\\${delimiter}`, 'g')) || []).length
      )
      const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length

      // If most lines have similar delimiter counts, it's likely structured
      if (avgCount > 2 && counts.every((c) => Math.abs(c - avgCount) <= 2)) {
        return true
      }
    }

    return false
  }
}
