import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { type Options, parse } from 'csv-parse'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CsvParser')

const CONFIG = {
  MAX_PREVIEW_ROWS: 1000, // Only keep first 1000 rows for preview
  MAX_SAMPLE_ROWS: 100, // Sample for metadata
  MAX_ERRORS: 100, // Stop after 100 errors
  STREAM_CHUNK_SIZE: 16384, // 16KB chunks for streaming
}

export class CsvParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const stream = createReadStream(filePath, {
      highWaterMark: CONFIG.STREAM_CHUNK_SIZE,
    })

    return this.parseStream(stream)
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    const bufferSize = buffer.length
    logger.info(
      `Parsing CSV buffer, size: ${bufferSize} bytes (${(bufferSize / 1024 / 1024).toFixed(2)} MB)`
    )

    const stream = Readable.from(buffer, {
      highWaterMark: CONFIG.STREAM_CHUNK_SIZE,
    })

    return this.parseStream(stream)
  }

  private parseStream(inputStream: NodeJS.ReadableStream): Promise<FileParseResult> {
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
          reject(new Error(`Too many errors (${errorCount}). File may be corrupted.`))
        }
      })

      parser.on('error', (err: Error) => {
        logger.error('CSV parser error:', err)
        reject(new Error(`CSV parsing failed: ${err.message}`))
      })

      parser.on('end', () => {
        if (!aborted) {
          if (rowCount > CONFIG.MAX_PREVIEW_ROWS) {
            processedContent += `\n[... ${rowCount.toLocaleString()} total rows, showing first ${CONFIG.MAX_PREVIEW_ROWS} ...]\n`
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
