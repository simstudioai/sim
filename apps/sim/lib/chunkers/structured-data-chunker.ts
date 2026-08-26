import { createLogger } from '@sim/logger'
import { ChunkBudget } from '@/lib/chunkers/chunk-budget'
import type { Chunk, StructuredDataOptions } from '@/lib/chunkers/types'
import {
  iterateLines,
  iterateLosslessWordBoundaryChunkSpans,
  normalizeTokenChunkSize,
} from '@/lib/chunkers/utils'

/** Structured data is denser in tokens (~3 chars/token vs ~4 for prose) */
function estimateStructuredTokens(text: string): number {
  if (!text?.trim()) return 0
  return Math.ceil(text.length / 3)
}

function estimateFormattedChunkTokens(
  headerLine: string,
  rowCharacters: number,
  rowCount: number,
  sheetName?: string
): number {
  let characters = rowCharacters + Math.max(0, rowCount - 1)
  if (sheetName) characters += 4 + sheetName.length + 6
  if (DEFAULT_CONFIG.INCLUDE_HEADERS_IN_EACH_CHUNK) {
    characters += 9 + headerLine.length + 1
    characters += Math.min(80, headerLine.length) + 1
  }
  characters += 3 + String(rowCount).length + 14
  return Math.ceil(characters / 3)
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
    const targetChunkSize = normalizeTokenChunkSize(
      options.chunkSize ?? DEFAULT_CONFIG.TARGET_CHUNK_SIZE,
      'Structured data chunk size'
    )

    const chunks: Chunk[] = []
    const sampleLines: string[] = []
    for (const line of iterateLines(content)) {
      if (!line.trim()) continue
      sampleLines.push(line)
      if (sampleLines.length === 10) break
    }

    if (sampleLines.length === 0) {
      return chunks
    }

    const budget = new ChunkBudget(options.maxChunks)
    const headerLine = options.headers?.join('\t') || sampleLines[0]
    const dataStartIndex = options.headers ? 0 : 1

    const estimatedTokensPerRow = StructuredDataChunker.estimateStructuredTokensPerRow(
      sampleLines.slice(dataStartIndex)
    )
    const optimalRowsPerChunk = StructuredDataChunker.calculateOptimalRowsPerChunk(
      estimatedTokensPerRow,
      targetChunkSize
    )

    let currentChunkRows: string[] = []
    let currentRowsCharacters = 0
    let chunkStartRow = dataStartIndex
    let oversizedHeaderEmitted = false

    let lineIndex = 0
    for (const row of iterateLines(content)) {
      if (!row.trim()) continue
      const i = lineIndex
      lineIndex++
      if (i < dataStartIndex) continue

      const standaloneRow = StructuredDataChunker.formatChunk(headerLine, [row], options.sheetName)
      if (estimateStructuredTokens(standaloneRow) > targetChunkSize) {
        if (currentChunkRows.length > 0) {
          const chunkContent = StructuredDataChunker.formatChunk(
            headerLine,
            currentChunkRows,
            options.sheetName
          )
          budget.add(chunks, StructuredDataChunker.createChunk(chunkContent, chunkStartRow, i - 1))
          currentChunkRows = []
          currentRowsCharacters = 0
        }
        const emptyRowOverhead = estimateStructuredTokens(
          StructuredDataChunker.formatChunk(headerLine, [''], options.sheetName)
        )
        if (emptyRowOverhead >= targetChunkSize) {
          if (!oversizedHeaderEmitted) {
            const headerContent = options.sheetName
              ? `${options.sheetName}\n${headerLine}`
              : headerLine
            const headerRow = Math.max(0, dataStartIndex - 1)
            for (const segment of iterateLosslessWordBoundaryChunkSpans(
              headerContent,
              targetChunkSize * 3
            )) {
              budget.add(
                chunks,
                StructuredDataChunker.createChunk(segment.text, headerRow, headerRow)
              )
            }
            oversizedHeaderEmitted = true
          }
          for (const segment of iterateLosslessWordBoundaryChunkSpans(row, targetChunkSize * 3)) {
            budget.add(chunks, StructuredDataChunker.createChunk(segment.text, i, i))
          }
          chunkStartRow = i + 1
          continue
        }
        const rowSegmentChars = Math.max(1, (targetChunkSize - emptyRowOverhead) * 3)
        for (const segment of iterateLosslessWordBoundaryChunkSpans(row, rowSegmentChars)) {
          const segmentContent = StructuredDataChunker.formatChunk(
            headerLine,
            [segment.text],
            options.sheetName
          )
          budget.add(chunks, StructuredDataChunker.createChunk(segmentContent, i, i))
        }
        chunkStartRow = i + 1
        continue
      }

      const projectedTokens = estimateFormattedChunkTokens(
        headerLine,
        currentRowsCharacters + row.length,
        currentChunkRows.length + 1,
        options.sheetName
      )

      const shouldCreateChunk =
        (projectedTokens > targetChunkSize && currentChunkRows.length > 0) ||
        currentChunkRows.length >= optimalRowsPerChunk

      if (shouldCreateChunk && currentChunkRows.length > 0) {
        const chunkContent = StructuredDataChunker.formatChunk(
          headerLine,
          currentChunkRows,
          options.sheetName
        )
        budget.add(chunks, StructuredDataChunker.createChunk(chunkContent, chunkStartRow, i - 1))

        currentChunkRows = []
        currentRowsCharacters = 0
        chunkStartRow = i
      }

      currentChunkRows.push(row)
      currentRowsCharacters += row.length
    }

    if (currentChunkRows.length > 0) {
      const chunkContent = StructuredDataChunker.formatChunk(
        headerLine,
        currentChunkRows,
        options.sheetName
      )
      budget.add(
        chunks,
        StructuredDataChunker.createChunk(chunkContent, chunkStartRow, lineIndex - 1)
      )
    }

    logger.info(
      `Created ${chunks.length} chunks from ${lineIndex} rows of structured data at ~${estimatedTokensPerRow} tokens/row and ${optimalRowsPerChunk} rows/chunk (target: ${targetChunkSize} tokens)`
    )

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

    const lines: string[] = []
    for (const line of iterateLines(content)) {
      lines.push(line)
      if (lines.length === 10) break
    }
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
