import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import mammoth from 'mammoth'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'

const logger = createLogger('DocxParser')

interface MammothMessage {
  type: 'warning' | 'error'
  message: string
}

interface MammothResult {
  value: string
  messages: MammothMessage[]
}

export class DocxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      const buffer = await readFile(filePath)
      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('DOCX file error:', error)
      throw new Error(`Failed to parse DOCX file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer provided')
      }

      try {
        const result = await mammoth.extractRawText({ buffer })

        if (result.value && result.value.trim().length > 0) {
          let htmlResult: MammothResult = { value: '', messages: [] }
          try {
            htmlResult = await mammoth.convertToHtml({ buffer })
          } catch {
            // HTML conversion is optional
          }

          return {
            content: sanitizeTextForUTF8(result.value),
            metadata: {
              extractionMethod: 'mammoth',
              messages: [...result.messages, ...htmlResult.messages],
              html: htmlResult.value,
            },
          }
        }
      } catch (mammothError) {
        logger.warn('mammoth failed, trying officeparser:', mammothError)
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
                extractionMethod: 'officeparser',
                characterCount: content.length,
              },
            }
          }
        }
      } catch (officeError) {
        logger.warn('officeparser failed:', officeError)
      }

      const isZipFile = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
      if (!isZipFile) {
        const textContent = buffer.toString('utf8').trim()
        if (textContent.length > 0) {
          return {
            content: sanitizeTextForUTF8(textContent),
            metadata: {
              extractionMethod: 'plaintext-fallback',
              characterCount: textContent.length,
              warning: 'File is not a valid DOCX format, extracted as plain text',
            },
          }
        }
      }

      throw new Error('Failed to extract text from DOCX file')
    } catch (error) {
      logger.error('DOCX parsing error:', error)
      throw new Error(`Failed to parse DOCX buffer: ${(error as Error).message}`)
    }
  }
}
