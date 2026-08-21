import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import * as XLSX from 'xlsx'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8, truncationNotice } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

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
  /**
   * Read the file into a buffer and delegate to {@link parseBuffer} so the
   * decompression-bomb guard runs before SheetJS inflates the workbook.
   */
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      logger.info(`Parsing XLSX file: ${filePath}`)

      const buffer = await readFile(filePath)
      return this.parseBuffer(buffer)
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

      assertOoxmlArchiveWithinLimits(buffer)

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

      /**
       * Converted over a bounded window rather than the whole sheet.
       *
       * `sheet_to_json` allocates from the worksheet's DECLARED `!ref` range,
       * not from its populated cells, and Excel routinely writes an inflated
       * range from stray formatting — a sheet claiming hundreds of thousands of
       * rows materializes that many arrays whatever it actually contains. The
       * row cap below used to be applied after the conversion, so it bounded the
       * emitted string while the allocation it was meant to bound had already
       * happened: an 880 KB workbook exhausted an 8 GB worker, and the same
       * content exhausted 16 GB when this ran inside the connector sync. No
       * machine size fixes that, because the allocation scales with a number the
       * file declares about itself.
       *
       * `defval` is gone with it. Defaulting every cell in the range made each
       * row dense — allocation proportional to columns x rows rather than to
       * populated cells — and, because no row was left empty, it also silently
       * defeated the `blankrows: false` beside it.
       */
      const lastPreviewRow = Math.min(range.e.r, range.s.r + CONFIG.MAX_PREVIEW_ROWS - 1)
      const sheetData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        blankrows: false, // Skip blank rows
        range: { s: { r: range.s.r, c: range.s.c }, e: { r: lastPreviewRow, c: range.e.c } },
      })

      // Reported from the declared range, as before, so bounding the conversion
      // does not change what the metadata says the workbook holds.
      const actualRowCount = sheetData.length
      totalRows += rowCount

      // Store limited sample for metadata
      if (sampledData.length < CONFIG.MAX_SAMPLE_ROWS) {
        const sampleSize = Math.min(CONFIG.MAX_SAMPLE_ROWS - sampledData.length, actualRowCount)
        sampledData.push(...sheetData.slice(0, sampleSize))
      }

      // Already bounded by the conversion window above.
      const rowsToProcess = actualRowCount
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

        /**
         * Compared against the DECLARED row count, not the converted one. The
         * conversion is now bounded to the preview window, so the converted
         * length can never exceed it — comparing the two made this unreachable
         * and silently dropped the notice from every sheet larger than the cap.
         */
        if (rowCount > rowsToProcess) {
          content += truncationNotice(
            `${rowCount.toLocaleString()} total rows, showing first ${rowsToProcess.toLocaleString()}`
          )
          truncated = true
        }
      } else {
        content += '[Empty sheet]\n'
      }

      if (contentSize > CONFIG.MAX_CONTENT_SIZE) {
        content += truncationNotice('Content truncated due to size limits')
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
    cellStr = truncate(cellStr, CONFIG.MAX_CELL_LENGTH)

    return sanitizeTextForUTF8(cellStr)
  }
}
