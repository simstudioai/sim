import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PptxParser')

export class PptxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      logger.info(`Parsing PowerPoint file: ${filePath}`)

      const buffer = await readFile(filePath)
      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('PowerPoint file parsing error:', error)
      throw new Error(`Failed to parse PowerPoint file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing PowerPoint buffer, size:', buffer.length)

      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer provided')
      }

      let parseOfficeAsync
      try {
        const officeParser = await import('officeparser')
        parseOfficeAsync = officeParser.parseOfficeAsync
      } catch (importError) {
        logger.warn('officeparser not available, using fallback extraction')
        return this.fallbackExtraction(buffer)
      }

      try {
        const result = await parseOfficeAsync(buffer)

        if (!result || typeof result !== 'string') {
          throw new Error('officeparser returned invalid result')
        }

        const content = sanitizeTextForUTF8(result.trim())

        logger.info('PowerPoint parsing completed successfully with officeparser')

        return {
          content: content,
          metadata: {
            characterCount: content.length,
            extractionMethod: 'officeparser',
          },
        }
      } catch (extractError) {
        logger.warn('officeparser failed, using fallback:', extractError)
        return this.fallbackExtraction(buffer)
      }
    } catch (error) {
      logger.error('PowerPoint buffer parsing error:', error)
      throw new Error(`Failed to parse PowerPoint buffer: ${(error as Error).message}`)
    }
  }

  private fallbackExtraction(buffer: Buffer): FileParseResult {
    logger.info('Using fallback text extraction for PowerPoint file')

    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 200000))

    const readableText = text
      .match(/[\x20-\x7E\s]{4,}/g)
      ?.filter(
        (chunk) =>
          chunk.trim().length > 10 &&
          /[a-zA-Z]/.test(chunk) &&
          !/^[\x00-\x1F]*$/.test(chunk) &&
          !/^[^\w\s]*$/.test(chunk)
      )
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    const content = readableText
      ? sanitizeTextForUTF8(readableText)
      : 'Unable to extract text from PowerPoint file. Please ensure the file contains readable text content.'

    return {
      content,
      metadata: {
        extractionMethod: 'fallback',
        characterCount: content.length,
        warning: 'Basic text extraction used',
      },
    }
  }
}
