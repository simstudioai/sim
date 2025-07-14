import { readFile } from 'fs/promises'
import mammoth from 'mammoth'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DocxParser')

// Define interface for mammoth result
interface MammothResult {
  value: string
  messages: any[]
}

export class DocxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      // Validate input
      if (!filePath) {
        throw new Error('No file path provided')
      }

      // Read the file
      const buffer = await readFile(filePath)

      // Use parseBuffer for consistent implementation
      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('DOCX file error:', error)
      throw new Error(`Failed to parse DOCX file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing buffer, size:', buffer.length)

      // Extract text with mammoth
      const result = await mammoth.extractRawText({ buffer })

      // Extract HTML for metadata (optional - won't fail if this fails)
      let htmlResult: MammothResult = { value: '', messages: [] }
      try {
        htmlResult = await mammoth.convertToHtml({ buffer })
      } catch (htmlError) {
        logger.warn('HTML conversion warning:', htmlError)
      }

      return {
        content: result.value,
        metadata: {
          messages: [...result.messages, ...htmlResult.messages],
          html: htmlResult.value,
        },
      }
    } catch (error) {
      logger.error('DOCX buffer parsing error:', error)
      throw new Error(`Failed to parse DOCX buffer: ${(error as Error).message}`)
    }
  }
}
