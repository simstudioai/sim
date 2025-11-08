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

      const { PDFParse } = await import('pdf-parse')

      const parser = new PDFParse({ data: dataBuffer })
      const textResult = await parser.getText()
      const infoResult = await parser.getInfo()
      await parser.destroy()

      logger.info(
        'PDF parsed successfully, pages:',
        textResult.total,
        'text length:',
        textResult.text.length
      )

      const cleanContent = textResult.text.replace(/\u0000/g, '')

      return {
        content: cleanContent,
        metadata: {
          pageCount: textResult.total,
          info: infoResult.info,
          version: infoResult.metadata?.get('pdf:PDFVersion'),
          source: 'pdf-parse',
        },
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    }
  }
}
