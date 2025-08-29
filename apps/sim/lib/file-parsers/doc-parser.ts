import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DocParser')

export class DocParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      // Validate input
      if (!filePath) {
        throw new Error('No file path provided')
      }

      // Check if file exists
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      logger.info(`Parsing DOC file: ${filePath}`)

      // Read the file
      const buffer = await readFile(filePath)
      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('DOC file parsing error:', error)
      throw new Error(`Failed to parse DOC file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing DOC buffer, size:', buffer.length)

      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer provided')
      }

      // Try to dynamically import the word extractor
      let WordExtractor
      try {
        WordExtractor = (await import('word-extractor')).default
      } catch (importError) {
        logger.warn('word-extractor not available, using fallback extraction')
        return this.fallbackExtraction(buffer)
      }

      try {
        const extractor = new WordExtractor()
        const extracted = await extractor.extract(buffer)

        const content = sanitizeTextForUTF8(extracted.getBody())
        const headers = extracted.getHeaders()
        const footers = extracted.getFooters()

        // Combine body with headers/footers if they exist
        let fullContent = content
        if (headers?.trim()) {
          fullContent = `${sanitizeTextForUTF8(headers)}\n\n${fullContent}`
        }
        if (footers?.trim()) {
          fullContent = `${fullContent}\n\n${sanitizeTextForUTF8(footers)}`
        }

        logger.info('DOC parsing completed successfully')

        return {
          content: fullContent.trim(),
          metadata: {
            hasHeaders: !!headers?.trim(),
            hasFooters: !!footers?.trim(),
            characterCount: fullContent.length,
            extractionMethod: 'word-extractor',
          },
        }
      } catch (extractError) {
        logger.warn('word-extractor failed, using fallback:', extractError)
        return this.fallbackExtraction(buffer)
      }
    } catch (error) {
      logger.error('DOC buffer parsing error:', error)
      throw new Error(`Failed to parse DOC buffer: ${(error as Error).message}`)
    }
  }

  /**
   * Fallback extraction method for when word-extractor is not available
   * This is a very basic extraction that looks for readable text in the binary
   */
  private fallbackExtraction(buffer: Buffer): FileParseResult {
    logger.info('Using fallback text extraction for DOC file')

    // Convert buffer to string and try to extract readable text
    // This is very basic and won't work well for complex DOC files
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 100000)) // Limit to first 100KB

    // Extract sequences of printable ASCII characters
    const readableText = text
      .match(/[\x20-\x7E\s]{4,}/g) // Find sequences of 4+ printable characters
      ?.filter(
        (chunk) =>
          chunk.trim().length > 10 && // Minimum length
          /[a-zA-Z]/.test(chunk) && // Must contain letters
          !/^[\x00-\x1F]*$/.test(chunk) // Not just control characters
      )
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    const content = readableText
      ? sanitizeTextForUTF8(readableText)
      : 'Unable to extract text from DOC file. Please convert to DOCX format for better results.'

    return {
      content,
      metadata: {
        extractionMethod: 'fallback',
        characterCount: content.length,
        warning:
          'Basic text extraction used. For better results, install word-extractor package or convert to DOCX format.',
      },
    }
  }
}
