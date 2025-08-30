import { readFile } from 'fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console/logger'
import { RawPdfParser } from './raw-pdf-parser'

const logger = createLogger('PdfParser')
const rawPdfParser = new RawPdfParser()

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

      try {
        logger.info('Attempting to parse with pdf-lib library...')

        logger.info('Starting PDF parsing...')
        const pdfDoc = await PDFDocument.load(dataBuffer)
        const pages = pdfDoc.getPages()
        const pageCount = pages.length

        logger.info('PDF parsed successfully with pdf-lib, pages:', pageCount)

        const metadata: Record<string, any> = {
          pageCount,
        }

        try {
          const title = pdfDoc.getTitle()
          const author = pdfDoc.getAuthor()
          const subject = pdfDoc.getSubject()
          const creator = pdfDoc.getCreator()
          const producer = pdfDoc.getProducer()
          const creationDate = pdfDoc.getCreationDate()
          const modificationDate = pdfDoc.getModificationDate()

          if (title) metadata.title = title
          if (author) metadata.author = author
          if (subject) metadata.subject = subject
          if (creator) metadata.creator = creator
          if (producer) metadata.producer = producer
          if (creationDate) metadata.creationDate = creationDate.toISOString()
          if (modificationDate) metadata.modificationDate = modificationDate.toISOString()
        } catch (metadataError) {
          logger.warn('Could not extract PDF metadata:', metadataError)
        }

        logger.info(
          'pdf-lib loaded successfully, but text extraction requires fallback to raw parser'
        )
        const rawResult = await rawPdfParser.parseBuffer(dataBuffer)

        return {
          content: rawResult.content,
          metadata: {
            ...rawResult.metadata,
            ...metadata,
            source: 'pdf-lib + raw-parser',
          },
        }
      } catch (pdfLibError: unknown) {
        logger.error('PDF-lib library failed:', pdfLibError)

        logger.info('Falling back to raw PDF parser...')
        const rawResult = await rawPdfParser.parseBuffer(dataBuffer)

        return {
          ...rawResult,
          metadata: {
            ...rawResult.metadata,
            fallback: true,
            source: 'raw-parser-only',
            error: (pdfLibError as Error).message || 'Unknown error',
          },
        }
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    }
  }
}
