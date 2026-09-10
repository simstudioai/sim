import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import {
  FileParserError,
  isEncryptedOfficeParserError,
  isFileParserError,
} from '@/lib/file-parsers/errors'
import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'
import { extractPresentationText } from '@/lib/file-parsers/ooxml-presentation'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits, isZipShaped } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('PptxParser')

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * An OLE2 compound file: either a legacy PowerPoint 97 `.ppt` or an OOXML
 * `EncryptedPackage`, which wraps the encrypted ZIP in the same container.
 */
function isOleShaped(buffer: Buffer): boolean {
  return buffer.length >= OLE_SIGNATURE.length && buffer.subarray(0, 8).equals(OLE_SIGNATURE)
}

/**
 * Extracts presentation text. PresentationML packages go through the slide XML
 * walker, which keeps table rows together and skips layout placeholders. OLE
 * containers are handed to officeparser only to classify encryption — legacy
 * `.ppt` has no pure-JS extractor, so it is rejected as unsupported rather than
 * scraped for printable bytes.
 */
export class PptxParser implements FileParser {
  async parseFile(filePath: string, options: FileParseOptions = {}): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    logger.info(`Parsing PowerPoint file: ${filePath}`)

    const buffer = await readFile(filePath, { signal: options.signal })
    return this.parseBuffer(buffer, options)
  }

  async parseBuffer(buffer: Buffer, options: FileParseOptions = {}): Promise<FileParseResult> {
    logger.info('Parsing PowerPoint buffer, size:', buffer.length)

    options.signal?.throwIfAborted()
    if (!buffer || buffer.length === 0) {
      throw new FileParserError('empty_input', 'Empty buffer provided')
    }

    assertOoxmlArchiveWithinLimits(buffer)

    if (isZipShaped(buffer)) {
      return this.parsePackage(buffer, options)
    }

    if (isOleShaped(buffer)) {
      return this.parseOleContainer(buffer, options)
    }

    throw new FileParserError(
      'invalid_format',
      'The file is neither a PowerPoint package nor a legacy PowerPoint binary'
    )
  }

  private async parsePackage(buffer: Buffer, options: FileParseOptions): Promise<FileParseResult> {
    let extracted: string
    try {
      extracted = await extractPresentationText(buffer, options)
    } catch (error) {
      options.signal?.throwIfAborted()
      if (isFileParserError(error)) throw error
      throw new FileParserError(
        'invalid_format',
        'The PowerPoint container could not be read',
        error
      )
    }

    const content = sanitizeTextForUTF8(extracted.trim())
    if (!content) {
      throw new FileParserError(
        'no_extractable_text',
        'No text could be extracted from this presentation'
      )
    }

    return {
      content,
      metadata: {
        characterCount: content.length,
        extractionMethod: 'ooxml-walker',
      },
    }
  }

  private async parseOleContainer(
    buffer: Buffer,
    options: FileParseOptions
  ): Promise<FileParseResult> {
    try {
      const result = await parseOfficeText(buffer, options)
      const content = typeof result === 'string' ? sanitizeTextForUTF8(result.trim()) : ''
      if (content) {
        return {
          content,
          metadata: {
            characterCount: content.length,
            extractionMethod: 'officeparser',
          },
        }
      }
    } catch (error) {
      options.signal?.throwIfAborted()
      if (isEncryptedOfficeParserError(error)) {
        throw new FileParserError(
          'encrypted_file',
          'This presentation is encrypted or password-protected',
          error
        )
      }
      if (isFileParserError(error) && error.code === 'runtime_failure') throw error
    }

    throw new FileParserError(
      'unsupported_type',
      'Legacy .ppt presentations are not supported. Save the file as .pptx and retry.'
    )
  }
}
