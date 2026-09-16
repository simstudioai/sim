import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { decodeTextBuffer, sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'

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

      const decoded = decodeTextBuffer(buffer)
      const result = sanitizeTextForUTF8(decoded.text)

      return {
        content: result,
        metadata: {
          characterCount: result.length,
          tokenCount: result.length / 4,
          encoding: decoded.encoding,
          ...(decoded.warning ? { warning: decoded.warning } : {}),
        },
      }
    } catch (error) {
      logger.error('TXT buffer parsing error:', error)
      throw new Error(`Failed to parse TXT buffer: ${(error as Error).message}`)
    }
  }
}
