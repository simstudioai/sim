import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { FileParserError, isEncryptedOfficeParserError } from '@/lib/file-parsers/errors'
import { extractOpenDocumentText } from '@/lib/file-parsers/odf-text'
import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('OpenDocumentParser')

/**
 * Extracts text from OpenDocument text and presentation files (`.odt`, `.odp`) —
 * the formats LibreOffice, OpenOffice, and Google Docs exports produce, which
 * turn up in document libraries alongside their Microsoft equivalents.
 *
 * The primary path walks `content.xml` directly so tables keep their rows,
 * lists keep their markers, and reviewer annotations and tracked deletions are
 * dropped instead of being spliced into the body. `officeparser` remains the
 * fallback for an archive the walker cannot read, and is what classifies
 * encrypted packages. Unlike the legacy `.doc`/`.ppt` parsers this deliberately
 * has **no** best-effort byte scrape: a failure means the archive is unreadable
 * or has no text, and throwing lets the caller record a real failure.
 *
 * Spreadsheets (`.ods`) go to `XlsxParser` instead, which SheetJS reads natively
 * and renders with per-sheet structure rather than one flat text run.
 */
export class OpenDocumentParser implements FileParser {
  async parseFile(filePath: string, options: FileParseOptions = {}): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const buffer = await readFile(filePath, { signal: options.signal })
    return this.parseBuffer(buffer, options)
  }

  async parseBuffer(buffer: Buffer, options: FileParseOptions = {}): Promise<FileParseResult> {
    options.signal?.throwIfAborted()
    if (!buffer || buffer.length === 0) {
      throw new FileParserError('empty_input', 'Empty buffer provided')
    }

    /**
     * The container is a ZIP, so the decompression-bomb guard applies exactly as
     * it does for OOXML — and it must run before anything inflates an entry.
     */
    assertOoxmlArchiveWithinLimits(buffer)

    let extracted = ''
    let extractionMethod = 'odf-walker'
    try {
      extracted = await extractOpenDocumentText(buffer, options)
    } catch (walkerError) {
      options.signal?.throwIfAborted()
      logger.warn('OpenDocument walker failed, trying officeparser', {
        error: getErrorMessage(walkerError),
      })
      extractionMethod = 'officeparser'
      try {
        const result = await parseOfficeText(buffer, options)
        extracted = typeof result === 'string' ? result : ''
      } catch (error) {
        options.signal?.throwIfAborted()
        logger.error('OpenDocument parsing failed', { error: getErrorMessage(error) })
        if (isEncryptedOfficeParserError(error)) {
          throw new FileParserError(
            'encrypted_file',
            'This OpenDocument file is encrypted or password-protected',
            error
          )
        }
        throw new FileParserError('invalid_format', 'Failed to parse OpenDocument file', error)
      }
    }

    const content = sanitizeTextForUTF8(extracted.trim())
    if (!content) {
      throw new FileParserError(
        'no_extractable_text',
        'No text could be extracted from this OpenDocument file'
      )
    }

    return {
      content,
      metadata: {
        characterCount: content.length,
        extractionMethod,
      },
    }
  }
}
