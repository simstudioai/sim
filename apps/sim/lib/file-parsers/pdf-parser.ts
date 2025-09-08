import { readFile } from 'fs/promises'
import pdfParse from 'pdf-parse'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PdfParser')

export class PdfParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse file:', filePath)

      if (!filePath) {
        throw new Error('No file path provided')
      }

      logger.info('Reading file...')
      const dataBuffer = await readFile(filePath)
      logger.info('File read successfully, size:', dataBuffer.length)

      return this.parseBuffer(dataBuffer)
    } catch (error) {
      logger.error('Error reading file:', error)
      throw error
    }
  }

  async parseBuffer(dataBuffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse buffer, size:', dataBuffer.length)

      const pdfData = await pdfParse(dataBuffer)

      logger.info(
        'PDF parsed successfully, pages:',
        pdfData.numpages,
        'text length:',
        pdfData.text.length
      )

      return {
        content: pdfData.text,
        metadata: {
          pageCount: pdfData.numpages,
          info: pdfData.info,
          version: pdfData.version,
          source: 'pdf-parse',
        },
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    }
  }
}
