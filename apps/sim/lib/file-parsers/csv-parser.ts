import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { Readable } from 'stream'
import { createLogger } from '@sim/logger'
import { type Options, parse } from 'csv-parse'
import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import {
  type DecodedText,
  decodeTextBuffer,
  sanitizeTextForUTF8,
  truncationNotice,
} from '@/lib/file-parsers/utils'

const logger = createLogger('CsvParser')

const CONFIG = {
  MAX_PREVIEW_ROWS: 1000, // Only keep first 1000 rows for preview
  MAX_SAMPLE_ROWS: 100, // Sample for metadata
  MAX_ERRORS: 100, // Stop after 100 errors
}

export class CsvParser implements FileParser {
  /**
   * Reads the whole file before parsing rather than streaming 16 KB chunks:
   * encoding detection needs the complete byte sequence (a BOM-less UTF-16 or
   * Windows-1252 file cannot be recognized per chunk, and a multi-byte UTF-8
   * sequence split across chunk boundaries would be misread). The upload size
   * caps already bound the file, and `parseBuffer` — the production path —
   * always held the full buffer.
   */
  async parseFile(filePath: string): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    return this.parseBuffer(await readFile(filePath))
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    const bufferSize = buffer.length
    logger.info(
      `Parsing CSV buffer, size: ${bufferSize} bytes (${(bufferSize / 1024 / 1024).toFixed(2)} MB)`
    )

    const decoded = decodeTextBuffer(buffer)
    const stream = new Readable({ read() {} })
    stream.push(decoded.text)
    stream.push(null)

    return this.parseStream(stream, decoded)
  }

  private parseStream(
    inputStream: NodeJS.ReadableStream,
    decoded: DecodedText
  ): Promise<FileParseResult> {
    return new Promise((resolve, reject) => {
      let rowCount = 0
      let errorCount = 0
      let headers: string[] = []
      let processedContent = ''
      const sampledRows: any[] = []
      const errors: string[] = []
      let firstRowProcessed = false
      let aborted = false

      const parserOptions: Options = {
        columns: true, // Use first row as headers
        skip_empty_lines: true, // Skip empty lines
        trim: true, // Trim whitespace
        relax_column_count: true, // Allow variable column counts
        relax_quotes: true, // Be lenient with quotes
        skip_records_with_error: true, // Skip bad records
        raw: false,
        cast: false,
      }
      const parser = parse(parserOptions)

      parser.on('readable', () => {
        let record
        while ((record = parser.read()) !== null && !aborted) {
          rowCount++

          if (!firstRowProcessed && record) {
            headers = Object.keys(record).map((h) => sanitizeTextForUTF8(String(h)))
            processedContent = `${headers.join(', ')}\n`
            firstRowProcessed = true
          }

          if (rowCount <= CONFIG.MAX_PREVIEW_ROWS) {
            try {
              const cleanValues = Object.values(record).map((v: any) =>
                sanitizeTextForUTF8(String(v || ''))
              )
              processedContent += `${cleanValues.join(', ')}\n`

              if (rowCount <= CONFIG.MAX_SAMPLE_ROWS) {
                sampledRows.push(record)
              }
            } catch (err) {
              logger.warn(`Error processing row ${rowCount}:`, err)
            }
          }

          if (rowCount % 10000 === 0) {
            logger.info(`Processed ${rowCount} rows...`)
          }
        }
      })

      parser.on('skip', (err: any) => {
        errorCount++

        if (errorCount <= 5) {
          const errorMsg = `Row ${err.lines || rowCount}: ${err.message || 'Unknown error'}`
          errors.push(errorMsg)
          logger.warn('CSV skip:', errorMsg)
        }

        if (errorCount >= CONFIG.MAX_ERRORS) {
          aborted = true
          parser.destroy()
          reject(
            new FileParserError(
              'invalid_format',
              `Too many errors (${errorCount}). File may be corrupted.`
            )
          )
        }
      })

      parser.on('error', (err: Error) => {
        logger.error('CSV parser error:', err)
        reject(new FileParserError('invalid_format', `CSV parsing failed: ${err.message}`, err))
      })

      parser.on('end', () => {
        if (!aborted) {
          if (rowCount > CONFIG.MAX_PREVIEW_ROWS) {
            processedContent += truncationNotice(
              `${rowCount.toLocaleString()} total rows, showing first ${CONFIG.MAX_PREVIEW_ROWS}`
            )
          }

          logger.info(`CSV parsing complete: ${rowCount} rows, ${errorCount} errors`)

          resolve({
            content: sanitizeTextForUTF8(processedContent),
            metadata: {
              rowCount,
              headers,
              errorCount,
              errors: errors.slice(0, 10),
              truncated: rowCount > CONFIG.MAX_PREVIEW_ROWS,
              sampledData: sampledRows,
              encoding: decoded.encoding,
              ...(decoded.warning ? { warning: decoded.warning } : {}),
            },
          })
        }
      })

      inputStream.on('error', (err) => {
        logger.error('Input stream error:', err)
        parser.destroy()
        reject(new Error(`Stream error: ${err.message}`))
      })

      inputStream.pipe(parser)
    })
  }
}
