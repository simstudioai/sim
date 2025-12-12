import { existsSync } from 'fs'
import * as XLSX from 'xlsx'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('XlsxParser')

// Configuration for handling large XLSX files
const CONFIG = {
  MAX_PREVIEW_ROWS: 1000, // Only keep first 1000 rows for preview
  MAX_SAMPLE_ROWS: 100, // Sample for metadata
  ROWS_PER_CHUNK: 50, // Aggregate 50 rows per chunk to reduce chunk count
  MAX_CELL_LENGTH: 1000, // Truncate very long cell values
  MAX_CONTENT_SIZE: 10 * 1024 * 1024, // 10MB max content size
}

export class XlsxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      logger.info(`Parsing XLSX file: ${filePath}`)

      // Read with streaming option for large files
      const workbook = XLSX.readFile(filePath, {
        dense: true, // Use dense mode for better memory efficiency
        sheetStubs: false, // Don't create stub cells
      })

      return this.processWorkbook(workbook)
    } catch (error) {
      logger.error('XLSX file parsing error:', error)
      throw new Error(`Failed to parse XLSX file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      const bufferSize = buffer.length
      logger.info(
        `Parsing XLSX buffer, size: ${bufferSize} bytes (${(bufferSize / 1024 / 1024).toFixed(2)} MB)`
      )

      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer provided')
      }

      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        dense: true, // Use dense mode for better memory efficiency
        sheetStubs: false, // Don't create stub cells
      })

      return this.processWorkbook(workbook)
    } catch (error) {
      logger.error('XLSX buffer parsing error:', error)
      throw new Error(`Failed to parse XLSX buffer: ${(error as Error).message}`)
    }
  }

  private processWorkbook(workbook: XLSX.WorkBook): FileParseResult {
    const sheetNames = workbook.SheetNames
    let content = ''
    let totalRows = 0
    let truncated = false
    let contentSize = 0
    const sampledData: any[] = []

    for (const sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName]

      // Get sheet dimensions
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
      const rowCount = range.e.r - range.s.r + 1

      logger.info(`Processing sheet: ${sheetName} with ${rowCount} rows`)

      // Convert to JSON with header row
      const sheetData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '', // Default value for empty cells
        blankrows: false, // Skip blank rows
      })

      const actualRowCount = sheetData.length
      totalRows += actualRowCount

      // Store limited sample for metadata
      if (sampledData.length < CONFIG.MAX_SAMPLE_ROWS) {
        const sampleSize = Math.min(CONFIG.MAX_SAMPLE_ROWS - sampledData.length, actualRowCount)
        sampledData.push(...sheetData.slice(0, sampleSize))
      }

      // Only process limited rows for preview
      const rowsToProcess = Math.min(actualRowCount, CONFIG.MAX_PREVIEW_ROWS)
      const cleanSheetName = sanitizeTextForUTF8(sheetName)

      // Add sheet header
      const sheetHeader = `\n=== Sheet: ${cleanSheetName} ===\n`
      content += sheetHeader
      contentSize += sheetHeader.length

      if (actualRowCount > 0) {
        // Get headers if available
        const headers = sheetData[0] as any[]
        if (headers && headers.length > 0) {
          const headerRow = headers.map((h) => this.truncateCell(h)).join('\t')
          content += `${headerRow}\n`
          content += `${'-'.repeat(Math.min(80, headerRow.length))}\n`
          contentSize += headerRow.length + 82
        }

        // Process data rows in chunks
        let chunkContent = ''
        let chunkRowCount = 0

        for (let i = 1; i < rowsToProcess; i++) {
          const row = sheetData[i] as any[]
          if (row && row.length > 0) {
            const rowString = row.map((cell) => this.truncateCell(cell)).join('\t')

            chunkContent += `${rowString}\n`
            chunkRowCount++

            // Add chunk separator every N rows for better readability
            if (chunkRowCount >= CONFIG.ROWS_PER_CHUNK) {
              content += chunkContent
              contentSize += chunkContent.length
              chunkContent = ''
              chunkRowCount = 0

              // Check content size limit
              if (contentSize > CONFIG.MAX_CONTENT_SIZE) {
                truncated = true
                break
              }
            }
          }
        }

        // Add remaining chunk content
        if (chunkContent && contentSize < CONFIG.MAX_CONTENT_SIZE) {
          content += chunkContent
          contentSize += chunkContent.length
        }

        // Add truncation notice if needed
        if (actualRowCount > rowsToProcess) {
          const notice = `\n[... ${actualRowCount.toLocaleString()} total rows, showing first ${rowsToProcess.toLocaleString()} ...]\n`
          content += notice
          truncated = true
        }
      } else {
        content += '[Empty sheet]\n'
      }

      // Stop processing if content is too large
      if (contentSize > CONFIG.MAX_CONTENT_SIZE) {
        content += '\n[... Content truncated due to size limits ...]\n'
        truncated = true
        break
      }
    }

    logger.info(
      `XLSX parsing completed: ${sheetNames.length} sheets, ${totalRows} total rows, truncated: ${truncated}`
    )

    const cleanContent = sanitizeTextForUTF8(content).trim()

    return {
      content: cleanContent,
      metadata: {
        sheetCount: sheetNames.length,
        sheetNames: sheetNames,
        totalRows: totalRows,
        truncated: truncated,
        sampledData: sampledData.slice(0, CONFIG.MAX_SAMPLE_ROWS),
        contentSize: contentSize,
      },
    }
  }

  private truncateCell(cell: any): string {
    if (cell === null || cell === undefined) {
      return ''
    }

    let cellStr = String(cell)

    // Truncate very long cells
    if (cellStr.length > CONFIG.MAX_CELL_LENGTH) {
      cellStr = `${cellStr.substring(0, CONFIG.MAX_CELL_LENGTH)}...`
    }

    return sanitizeTextForUTF8(cellStr)
  }
}
