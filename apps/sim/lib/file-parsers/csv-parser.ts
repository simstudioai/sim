import { existsSync, readFileSync } from 'fs'
import * as Papa from 'papaparse'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CsvParser')

const PARSE_OPTIONS = {
  header: true,
  skipEmptyLines: true,
  transformHeader: (header: string) => sanitizeTextForUTF8(String(header)),
  transform: (value: string) => sanitizeTextForUTF8(String(value || '')),
}

export class CsvParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      const fileContent = readFileSync(filePath, 'utf8')

      const parseResult = Papa.parse(fileContent, PARSE_OPTIONS)

      if (parseResult.errors && parseResult.errors.length > 0) {
        const errorMessages = parseResult.errors.map((err) => err.message).join(', ')
        logger.error('CSV parsing errors:', parseResult.errors)
        throw new Error(`Failed to parse CSV file: ${errorMessages}`)
      }

      const results = parseResult.data as Record<string, any>[]
      const headers = parseResult.meta.fields || []

      let content = ''

      if (headers.length > 0) {
        const cleanHeaders = headers.map((h) => sanitizeTextForUTF8(String(h)))
        content += `${cleanHeaders.join(', ')}\n`
      }

      results.forEach((row) => {
        const cleanValues = Object.values(row).map((v) => sanitizeTextForUTF8(String(v || '')))
        content += `${cleanValues.join(', ')}\n`
      })

      return {
        content: sanitizeTextForUTF8(content),
        metadata: {
          rowCount: results.length,
          headers: headers,
          rawData: results,
        },
      }
    } catch (error) {
      logger.error('CSV general error:', error)
      throw new Error(`Failed to process CSV file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing buffer, size:', buffer.length)

      const fileContent = buffer.toString('utf8')

      const parseResult = Papa.parse(fileContent, PARSE_OPTIONS)

      if (parseResult.errors && parseResult.errors.length > 0) {
        const errorMessages = parseResult.errors.map((err) => err.message).join(', ')
        logger.error('CSV parsing errors:', parseResult.errors)
        throw new Error(`Failed to parse CSV buffer: ${errorMessages}`)
      }

      const results = parseResult.data as Record<string, any>[]
      const headers = parseResult.meta.fields || []

      let content = ''

      if (headers.length > 0) {
        const cleanHeaders = headers.map((h) => sanitizeTextForUTF8(String(h)))
        content += `${cleanHeaders.join(', ')}\n`
      }

      results.forEach((row) => {
        const cleanValues = Object.values(row).map((v) => sanitizeTextForUTF8(String(v || '')))
        content += `${cleanValues.join(', ')}\n`
      })

      return {
        content: sanitizeTextForUTF8(content),
        metadata: {
          rowCount: results.length,
          headers: headers,
          rawData: results,
        },
      }
    } catch (error) {
      logger.error('CSV buffer parsing error:', error)
      throw new Error(`Failed to process CSV buffer: ${(error as Error).message}`)
    }
  }
}
