import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import * as XLSX from 'xlsx'
import {
  FileParserError,
  isEncryptedOfficeParserError,
  toFileParserError,
} from '@/lib/file-parsers/errors'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8, truncationNotice } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('XlsxParser')

// Configuration for handling large XLSX files
const CONFIG = {
  MAX_PREVIEW_ROWS: 1000, // Only keep first 1000 rows for preview
  MAX_PREVIEW_COLUMNS: 256,
  MAX_SAMPLE_ROWS: 100, // Sample for metadata
  MAX_SAMPLE_COLUMNS: 32,
  MAX_SAMPLE_CELL_LENGTH: 256,
  MAX_SAMPLE_CHARACTERS: 1024 * 1024,
  MAX_CONTENT_SIZE: 10 * 1024 * 1024, // 10MB max content size
}

const CONTENT_LIMIT_NOTICE = truncationNotice('Content truncated due to size limits')

function sliceUtf8WithinByteLimit(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value

  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

export class XlsxParser implements FileParser {
  /**
   * Read the file into a buffer and delegate to {@link parseBuffer} so the
   * decompression-bomb guard runs before SheetJS inflates the workbook.
   */
  async parseFile(filePath: string): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    logger.info(`Parsing XLSX file: ${filePath}`)

    const buffer = await readFile(filePath)
    return this.parseBuffer(buffer)
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      const bufferSize = buffer.length
      logger.info(
        `Parsing XLSX buffer, size: ${bufferSize} bytes (${(bufferSize / 1024 / 1024).toFixed(2)} MB)`
      )

      if (!buffer || buffer.length === 0) {
        throw new FileParserError('empty_input', 'Empty buffer provided')
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
      if (isEncryptedOfficeParserError(error)) {
        throw new FileParserError(
          'encrypted_file',
          'This workbook is encrypted or password-protected',
          error
        )
      }
      throw toFileParserError(error, 'invalid_format', 'Failed to parse XLSX buffer')
    }
  }

  private processWorkbook(workbook: XLSX.WorkBook): FileParseResult {
    const sheetNames = workbook.SheetNames
    let content = ''
    let totalRows = 0
    let truncated = false
    let contentSize = 0
    let hasMeaningfulCellContent = false
    let outputLimitReached = false
    let sampleCharacters = 0
    const sampledData: unknown[][] = []

    const appendContent = (value: string): boolean => {
      const remaining = CONFIG.MAX_CONTENT_SIZE - contentSize
      const valueBytes = Buffer.byteLength(value, 'utf8')
      if (valueBytes <= remaining) {
        content += value
        contentSize += valueBytes
        return true
      }

      const noticeBytes = Buffer.byteLength(CONTENT_LIMIT_NOTICE, 'utf8')
      const retainedContent = sliceUtf8WithinByteLimit(
        content,
        Math.max(0, CONFIG.MAX_CONTENT_SIZE - noticeBytes)
      )
      const retainedBytes = Buffer.byteLength(retainedContent, 'utf8')
      const prefix = sliceUtf8WithinByteLimit(
        value,
        Math.max(0, CONFIG.MAX_CONTENT_SIZE - retainedBytes - noticeBytes)
      )
      content = retainedContent + prefix + CONTENT_LIMIT_NOTICE
      contentSize = Buffer.byteLength(content, 'utf8')
      truncated = true
      outputLimitReached = true
      return false
    }

    for (const sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName]

      // Get sheet dimensions
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
      const rowCount = range.e.r - range.s.r + 1
      const columnCount = range.e.c - range.s.c + 1

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
      const lastPreviewColumn = Math.min(range.e.c, range.s.c + CONFIG.MAX_PREVIEW_COLUMNS - 1)
      const sheetData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        blankrows: false, // Skip blank rows
        range: {
          s: { r: range.s.r, c: range.s.c },
          e: { r: lastPreviewRow, c: lastPreviewColumn },
        },
      })

      // Reported from the declared range, as before, so bounding the conversion
      // does not change what the metadata says the workbook holds.
      const actualRowCount = sheetData.length
      totalRows += rowCount

      for (const row of sheetData) {
        if (row.some((cell) => this.truncateCell(cell).trim().length > 0)) {
          hasMeaningfulCellContent = true
          break
        }
      }

      // Store limited sample for metadata
      if (sampledData.length < CONFIG.MAX_SAMPLE_ROWS) {
        const sampleSize = Math.min(CONFIG.MAX_SAMPLE_ROWS - sampledData.length, actualRowCount)
        for (const row of sheetData.slice(0, sampleSize)) {
          const sampleRow: string[] = []

          for (const cell of row.slice(0, CONFIG.MAX_SAMPLE_COLUMNS)) {
            const remaining = CONFIG.MAX_SAMPLE_CHARACTERS - sampleCharacters
            if (remaining <= 0) break

            const value = this.truncateCell(
              cell,
              Math.min(CONFIG.MAX_SAMPLE_CELL_LENGTH, remaining)
            )
            sampleRow.push(value)
            sampleCharacters += value.length
          }

          if (sampleRow.length > 0) sampledData.push(sampleRow)
          if (sampleCharacters >= CONFIG.MAX_SAMPLE_CHARACTERS) break
        }
      }

      // Already bounded by the conversion window above.
      const rowsToProcess = actualRowCount
      const cleanSheetName = sanitizeTextForUTF8(sheetName)

      // Add sheet header
      const sheetHeader = `\n=== Sheet: ${cleanSheetName} ===\n`
      if (!appendContent(sheetHeader)) break

      if (actualRowCount > 0) {
        // Get headers if available
        const headers = sheetData[0]
        if (headers && headers.length > 0) {
          const headerRow = headers.map((h) => this.truncateCell(h)).join('\t')
          if (!appendContent(`${headerRow}\n${'-'.repeat(Math.min(80, headerRow.length))}\n`)) {
            break
          }
        }

        for (let i = 1; i < rowsToProcess; i++) {
          const row = sheetData[i]
          if (row && row.length > 0) {
            const rowString = row.map((cell) => this.truncateCell(cell)).join('\t')
            if (!appendContent(`${rowString}\n`)) break
          }
        }

        if (outputLimitReached) break

        /**
         * Truncated means the WINDOW cut the sheet short, which is a question
         * about the declared range against the cap — not about how many rows
         * survived conversion. Comparing the converted length to the cap made
         * this unreachable once the conversion was bounded (the two are equal by
         * construction); comparing the declared count to the converted length
         * instead reported truncation for any sheet merely containing blank
         * rows, since those are now skipped. The CSV parser asks the same
         * question the same way.
         */
        if (rowCount > CONFIG.MAX_PREVIEW_ROWS || columnCount > CONFIG.MAX_PREVIEW_COLUMNS) {
          const rowSummary = `${rowCount.toLocaleString()} total rows, showing first ${rowsToProcess.toLocaleString()}`
          const columnSummary = `${columnCount.toLocaleString()} total columns, showing first ${Math.min(columnCount, CONFIG.MAX_PREVIEW_COLUMNS).toLocaleString()}`
          appendContent(
            truncationNotice(
              [
                rowCount > CONFIG.MAX_PREVIEW_ROWS ? rowSummary : null,
                columnCount > CONFIG.MAX_PREVIEW_COLUMNS ? columnSummary : null,
              ]
                .filter((summary): summary is string => summary !== null)
                .join('; ')
            )
          )
          truncated = true
        }
      } else {
        appendContent('[Empty sheet]\n')
      }

      if (outputLimitReached) break
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
        degraded: !hasMeaningfulCellContent,
        sampledData: sampledData.slice(0, CONFIG.MAX_SAMPLE_ROWS),
        contentSize: contentSize,
      },
    }
  }

  private truncateCell(cell: unknown, maxLength?: number): string {
    if (cell === null || cell === undefined) {
      return ''
    }

    let cellStr = String(cell)

    /**
     * Samples are previews; canonical content is bounded only by the aggregate
     * output ceiling so an otherwise valid long cell is never silently partial.
     */
    if (maxLength !== undefined && cellStr.length > maxLength) {
      cellStr = truncate(cellStr, Math.max(0, maxLength - 3))
    }

    return sanitizeTextForUTF8(cellStr)
  }
}
