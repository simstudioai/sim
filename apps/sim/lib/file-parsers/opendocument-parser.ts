import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('OpenDocumentParser')

/**
 * Extracts text from OpenDocument text and presentation files (`.odt`, `.odp`) —
 * the formats LibreOffice, OpenOffice, and Google Docs exports produce, which
 * turn up in document libraries alongside their Microsoft equivalents.
 *
 * `officeparser` handles the OpenDocument container natively. Unlike the legacy
 * `.doc`/`.ppt` parsers this deliberately has **no** best-effort fallback: an
 * OpenDocument file is a ZIP whose text lives in `content.xml`, so a failure here
 * means the archive is unreadable or has no text, and scraping the raw bytes would
 * only produce XML markup. Throwing lets the caller record a real failure.
 *
 * Spreadsheets (`.ods`) go to `XlsxParser` instead, which SheetJS reads natively
 * and renders with per-sheet structure rather than one flat text run.
 */
export class OpenDocumentParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const buffer = await readFile(filePath)
    return this.parseBuffer(buffer)
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty buffer provided')
    }

    /**
     * The container is a ZIP, so the decompression-bomb guard applies exactly as
     * it does for OOXML — and it must run before officeparser inflates anything.
     */
    assertOoxmlArchiveWithinLimits(buffer)

    const { parseOfficeAsync } = await import('officeparser')

    let extracted: string
    try {
      const result = await parseOfficeAsync(buffer)
      extracted = typeof result === 'string' ? result : ''
    } catch (error) {
      logger.error('OpenDocument parsing failed', { error: (error as Error).message })
      throw new Error(`Failed to parse OpenDocument file: ${(error as Error).message}`)
    }

    const content = sanitizeTextForUTF8(extracted.trim())
    if (!content) {
      throw new Error('Failed to extract text from OpenDocument file')
    }

    return {
      content,
      metadata: {
        characterCount: content.length,
        extractionMethod: 'officeparser',
      },
    }
  }
}
