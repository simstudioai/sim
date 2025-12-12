import { readFile } from 'fs/promises'
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

      const { extractText, getDocumentProxy } = await import('unpdf')

      const uint8Array = new Uint8Array(dataBuffer)

      const pdf = await getDocumentProxy(uint8Array)

      const { totalPages, text } = await extractText(pdf, { mergePages: true })

      logger.info('PDF parsed successfully, pages:', totalPages, 'text length:', text.length)

      const cleanContent = text.replace(/\u0000/g, '')

      return {
        content: cleanContent,
        metadata: {
          pageCount: totalPages,
          source: 'unpdf',
        },
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    }
  }
}
