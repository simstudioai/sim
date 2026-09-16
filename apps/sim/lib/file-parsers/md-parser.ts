import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { decodeTextBuffer, sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'

const logger = createLogger('MdParser')

export class MdParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      const buffer = await readFile(filePath)

      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('MD file error:', error)
      throw new Error(`Failed to parse MD file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing buffer, size:', buffer.length)

      const decoded = decodeTextBuffer(buffer)
      const content = sanitizeTextForUTF8(decoded.text)

      return {
        content,
        metadata: {
          characterCount: content.length,
          tokenCount: Math.floor(content.length / 4),
          encoding: decoded.encoding,
          ...(decoded.warning ? { warning: decoded.warning } : {}),
        },
      }
    } catch (error) {
      logger.error('MD buffer parsing error:', error)
      throw new Error(`Failed to parse MD buffer: ${(error as Error).message}`)
    }
  }
}
