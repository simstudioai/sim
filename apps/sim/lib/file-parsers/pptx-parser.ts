import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { FileParserError, isEncryptedOfficeParserError } from '@/lib/file-parsers/errors'
import { loadParseOfficeAsync } from '@/lib/file-parsers/officeparser-module'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('PptxParser')

export class PptxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    logger.info(`Parsing PowerPoint file: ${filePath}`)

    const buffer = await readFile(filePath)
    return this.parseBuffer(buffer)
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    logger.info('Parsing PowerPoint buffer, size:', buffer.length)

    if (!buffer || buffer.length === 0) {
      throw new FileParserError('empty_input', 'Empty buffer provided')
    }

    assertOoxmlArchiveWithinLimits(buffer)

    const parseOfficeAsync = await loadParseOfficeAsync()

    try {
      const result = await parseOfficeAsync(buffer)

      if (!result || typeof result !== 'string') {
        return this.fallbackExtraction(buffer)
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
      if (isEncryptedOfficeParserError(extractError)) {
        throw new FileParserError(
          'encrypted_file',
          'This presentation is encrypted or password-protected',
          extractError
        )
      }

      const isZipFile = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
      if (!isZipFile) {
        logger.warn('officeparser failed for legacy PowerPoint, using fallback:', extractError)
        return this.fallbackExtraction(buffer)
      }

      throw new FileParserError(
        'invalid_format',
        'The PowerPoint container could not be read',
        extractError
      )
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
        degraded: true,
        characterCount: content.length,
        warning: 'Basic text extraction used',
      },
    }
  }
}
