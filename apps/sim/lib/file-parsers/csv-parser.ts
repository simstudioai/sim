import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import csvParser from 'csv-parser'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CsvParser')

export class CsvParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    return new Promise((resolve, reject) => {
      try {
        // Validate input
        if (!filePath) {
          return reject(new Error('No file path provided'))
        }

        // Check if file exists
        if (!existsSync(filePath)) {
          return reject(new Error(`File not found: ${filePath}`))
        }

        const results: Record<string, any>[] = []
        const headers: string[] = []

        createReadStream(filePath)
          .on('error', (error: Error) => {
            logger.error('CSV stream error:', error)
            reject(new Error(`Failed to read CSV file: ${error.message}`))
          })
          .pipe(csvParser())
          .on('headers', (headerList: string[]) => {
            headers.push(...headerList)
          })
          .on('data', (data: Record<string, any>) => {
            results.push(data)
          })
          .on('end', () => {
            // Convert CSV data to a formatted string representation
            let content = ''

            // Add headers
            if (headers.length > 0) {
              content += `${headers.join(', ')}\n`
            }

            // Add rows
            results.forEach((row) => {
              const rowValues = Object.values(row).join(', ')
              content += `${rowValues}\n`
            })

            resolve({
              content,
              metadata: {
                rowCount: results.length,
                headers: headers,
                rawData: results,
              },
            })
          })
          .on('error', (error: Error) => {
            logger.error('CSV parsing error:', error)
            reject(new Error(`Failed to parse CSV file: ${error.message}`))
          })
      } catch (error) {
        logger.error('CSV general error:', error)
        reject(new Error(`Failed to process CSV file: ${(error as Error).message}`))
      }
    })
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Parsing buffer, size:', buffer.length)

        const results: Record<string, any>[] = []
        const headers: string[] = []

        // Create a readable stream from the buffer
        const bufferStream = new Readable()
        bufferStream.push(buffer)
        bufferStream.push(null) // Signal the end of the stream

        bufferStream
          .on('error', (error: Error) => {
            logger.error('CSV buffer stream error:', error)
            reject(new Error(`Failed to read CSV buffer: ${error.message}`))
          })
          .pipe(csvParser())
          .on('headers', (headerList: string[]) => {
            headers.push(...headerList)
          })
          .on('data', (data: Record<string, any>) => {
            results.push(data)
          })
          .on('end', () => {
            // Convert CSV data to a formatted string representation
            let content = ''

            // Add headers
            if (headers.length > 0) {
              content += `${headers.join(', ')}\n`
            }

            // Add rows
            results.forEach((row) => {
              const rowValues = Object.values(row).join(', ')
              content += `${rowValues}\n`
            })

            resolve({
              content,
              metadata: {
                rowCount: results.length,
                headers: headers,
                rawData: results,
              },
            })
          })
          .on('error', (error: Error) => {
            logger.error('CSV parsing error:', error)
            reject(new Error(`Failed to parse CSV buffer: ${error.message}`))
          })
      } catch (error) {
        logger.error('CSV buffer parsing error:', error)
        reject(new Error(`Failed to process CSV buffer: ${(error as Error).message}`))
      }
    })
  }
}
