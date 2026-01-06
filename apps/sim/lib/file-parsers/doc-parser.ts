import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'

const logger = createLogger('DocParser')

export class DocParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      const buffer = await readFile(filePath)
      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('DOC file parsing error:', error)
      throw new Error(`Failed to parse DOC file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer provided')
      }

      try {
        const officeParser = await import('officeparser')
        const result = await officeParser.parseOfficeAsync(buffer)

        if (result) {
          const resultString = typeof result === 'string' ? result : String(result)
          const content = sanitizeTextForUTF8(resultString.trim())

          if (content.length > 0) {
            return {
              content,
              metadata: {
                characterCount: content.length,
                extractionMethod: 'officeparser',
              },
            }
          }
        }
      } catch (officeError) {
        logger.warn('officeparser failed, trying mammoth:', officeError)
      }

      try {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer })

        if (result.value && result.value.trim().length > 0) {
          const content = sanitizeTextForUTF8(result.value.trim())
          return {
            content,
            metadata: {
              characterCount: content.length,
              extractionMethod: 'mammoth',
              messages: result.messages,
            },
          }
        }
      } catch (mammothError) {
        logger.warn('mammoth failed:', mammothError)
      }

      return this.fallbackExtraction(buffer)
    } catch (error) {
      logger.error('DOC parsing error:', error)
      throw new Error(`Failed to parse DOC buffer: ${(error as Error).message}`)
    }
  }

  private fallbackExtraction(buffer: Buffer): FileParseResult {
    const isBinaryDoc = buffer.length >= 2 && buffer[0] === 0xd0 && buffer[1] === 0xcf

    if (!isBinaryDoc) {
      const textContent = buffer.toString('utf8').trim()

      if (textContent.length > 0) {
        const printableChars = textContent.match(/[\x20-\x7E\n\r\t]/g)?.length || 0
        const isProbablyText = printableChars / textContent.length > 0.9

        if (isProbablyText) {
          return {
            content: sanitizeTextForUTF8(textContent),
            metadata: {
              extractionMethod: 'plaintext-fallback',
              characterCount: textContent.length,
              warning: 'File is not a valid DOC format, extracted as plain text',
            },
          }
        }
      }
    }

    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 100000))

    const readableText = text
      .match(/[\x20-\x7E\s]{4,}/g)
      ?.filter(
        (chunk) =>
          chunk.trim().length > 10 && /[a-zA-Z]/.test(chunk) && !/^[\x00-\x1F]*$/.test(chunk)
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
        warning: 'Basic text extraction used. For better results, convert to DOCX format.',
      },
    }
  }
}
