import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { FileParserError, isFileParserError } from '@/lib/file-parsers/errors'
import { isEncryptedOoxmlContainer, isOle2Container } from '@/lib/file-parsers/ooxml-encryption'
import { extractPresentationText } from '@/lib/file-parsers/ooxml-presentation'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits, isZipShaped } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('PptxParser')

/**
 * Extracts presentation text. PresentationML packages go through the slide XML
 * walker, which keeps table rows together and skips layout placeholders. An OLE
 * container is either an encrypted OOXML package, reported as such, or a legacy
 * `.ppt`, which has no pure-JS extractor and is rejected as unsupported rather
 * than scraped for printable bytes.
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

    if (isOle2Container(buffer)) {
      this.rejectOleContainer(buffer)
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

  /**
   * Neither OLE shape has a reader here: officeparser 5 only throws a generic
   * error for both, so the encrypted case is recognized from the container's
   * own stream directory instead.
   */
  private rejectOleContainer(buffer: Buffer): never {
    if (isEncryptedOoxmlContainer(buffer)) {
      throw new FileParserError(
        'encrypted_file',
        'This presentation is encrypted or password-protected'
      )
    }
    throw new FileParserError(
      'unsupported_type',
      'Legacy .ppt presentations are not supported. Save the file as .pptx and retry.'
    )
  }
}
