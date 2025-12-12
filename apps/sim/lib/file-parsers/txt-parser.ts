import { readFile } from 'fs/promises'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('TxtParser')

export class TxtParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      const buffer = await readFile(filePath)

      return this.parseBuffer(buffer)
    } catch (error) {
      logger.error('TXT file error:', error)
      throw new Error(`Failed to parse TXT file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing buffer, size:', buffer.length)

      const rawContent = buffer.toString('utf-8')
      const result = sanitizeTextForUTF8(rawContent)

      return {
        content: result,
        metadata: {
          characterCount: result.length,
          tokenCount: result.length / 4,
        },
      }
    } catch (error) {
      logger.error('TXT buffer parsing error:', error)
      throw new Error(`Failed to parse TXT buffer: ${(error as Error).message}`)
    }
  }
}
