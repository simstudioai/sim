import { readFile } from 'fs/promises'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

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

      const result = buffer.toString('utf-8')
      const content = sanitizeTextForUTF8(result)

      return {
        content,
        metadata: {
          characterCount: content.length,
          tokenCount: Math.floor(content.length / 4),
        },
      }
    } catch (error) {
      logger.error('MD buffer parsing error:', error)
      throw new Error(`Failed to parse MD buffer: ${(error as Error).message}`)
    }
  }
}
