import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import mammoth from 'mammoth'
import {
  FileParserError,
  isEncryptedOfficeParserError,
  toFileParserError,
} from '@/lib/file-parsers/errors'
import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

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
  async parseFile(filePath: string, options: FileParseOptions = {}): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    const buffer = await readFile(filePath, { signal: options.signal })
    return this.parseBuffer(buffer, options)
  }

  async parseBuffer(buffer: Buffer, options: FileParseOptions = {}): Promise<FileParseResult> {
    try {
      options.signal?.throwIfAborted()
      if (!buffer || buffer.length === 0) {
        throw new FileParserError('empty_input', 'Empty buffer provided')
      }

      assertOoxmlArchiveWithinLimits(buffer)

      const extractionErrors: unknown[] = []
      let parserReturnedEmpty = false

      try {
        const result = await mammoth.extractRawText({ buffer })
        options.signal?.throwIfAborted()

        if (result.value && result.value.trim().length > 0) {
          let htmlResult: MammothResult = { value: '', messages: [] }
          try {
            htmlResult = await mammoth.convertToHtml({ buffer })
          } catch {
            // HTML conversion is optional
          }
          options.signal?.throwIfAborted()

          return {
            content: sanitizeTextForUTF8(result.value),
            metadata: {
              extractionMethod: 'mammoth',
              messages: [...result.messages, ...htmlResult.messages],
              html: htmlResult.value,
            },
          }
        }
        parserReturnedEmpty = true
      } catch (mammothError) {
        options.signal?.throwIfAborted()
        logger.warn('mammoth failed, trying officeparser:', mammothError)
        extractionErrors.push(mammothError)
      }

      try {
        const result = await parseOfficeText(buffer, options)

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
        parserReturnedEmpty = true
      } catch (officeError) {
        options.signal?.throwIfAborted()
        logger.warn('officeparser failed:', officeError)
        extractionErrors.push(officeError)
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

      if (extractionErrors.some(isEncryptedOfficeParserError)) {
        throw new FileParserError(
          'encrypted_file',
          'This document is encrypted or password-protected',
          new AggregateError(extractionErrors)
        )
      }

      if (parserReturnedEmpty) {
        throw new FileParserError(
          'no_extractable_text',
          'No text could be extracted from this DOCX file',
          extractionErrors.length > 0 ? new AggregateError(extractionErrors) : undefined
        )
      }

      throw new FileParserError(
        'invalid_format',
        'The DOCX container could not be read',
        new AggregateError(extractionErrors)
      )
    } catch (error) {
      options.signal?.throwIfAborted()
      logger.error('DOCX parsing error:', error)
      throw toFileParserError(error, 'invalid_format', 'Failed to parse DOCX buffer')
    }
  }
}
