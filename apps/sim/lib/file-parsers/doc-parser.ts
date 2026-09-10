import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { FileParserError, toFileParserError } from '@/lib/file-parsers/errors'
import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'
import { sniffFileKind } from '@/lib/file-parsers/sniff'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { decodeTextBuffer, sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits, isZipShaped } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('DocParser')

/** word-extractor's rejection of a Word 6/95 (or non-Word) `FIB` identifier. */
const WORD_6_95_MAGIC_PATTERN = /Invalid magic number/i

interface LegacyDocSections {
  body: string
  headers: string
  footers: string
  footnotes: string
  endnotes: string
  textboxes: string
}

function joinSections(sections: LegacyDocSections): string {
  return [
    sections.body,
    sections.headers,
    sections.footers,
    sections.footnotes,
    sections.endnotes,
    sections.textboxes,
  ]
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join('\n\n')
}

export class DocParser implements FileParser {
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

  /**
   * Routes on the container rather than the name: a genuine OLE2 `.doc` goes to
   * word-extractor, a ZIP-shaped one is a misnamed OOXML package for
   * officeparser/mammoth, and plain text is returned as-is. Anything else is a
   * typed `invalid_format` — the former byte scrape returned ZIP part names or a
   * placeholder sentence, which automated callers then indexed as prose.
   *
   * `officeparser` and `mammoth` both accept an OOXML/ZIP container regardless of
   * its name, so the zip-bomb guard runs here exactly as it does in the
   * docx/pptx/xlsx parsers. It no-ops for genuine legacy OLE `.doc` buffers.
   */
  async parseBuffer(buffer: Buffer, options: FileParseOptions = {}): Promise<FileParseResult> {
    try {
      options.signal?.throwIfAborted()
      if (!buffer || buffer.length === 0) {
        throw new FileParserError('empty_input', 'Empty buffer provided')
      }

      assertOoxmlArchiveWithinLimits(buffer)

      if (isZipShaped(buffer)) {
        return await this.parseOoxmlContainer(buffer, options)
      }

      const kind = sniffFileKind(buffer)
      if (kind === 'ole2') {
        return await this.parseLegacyDoc(buffer, options)
      }
      if (kind === 'text' || kind === 'html') {
        return this.parsePlainText(buffer)
      }

      throw new FileParserError(
        'invalid_format',
        `File content does not match the .doc extension (detected ${kind}). Re-save it as DOCX and retry.`
      )
    } catch (error) {
      logger.error('DOC parsing error:', error)
      throw error
    }
  }

  /** A binary Word 97–2003 document, read through word-extractor's OLE2 reader. */
  private async parseLegacyDoc(
    buffer: Buffer,
    options: FileParseOptions
  ): Promise<FileParseResult> {
    const { default: WordExtractor } = await import('word-extractor')
    options.signal?.throwIfAborted()

    let sections: LegacyDocSections
    try {
      const document = await new WordExtractor().extract(buffer)
      const raw = { filterUnicode: false }
      sections = {
        body: document.getBody(raw),
        headers: document.getHeaders({ ...raw, includeFooters: false }),
        footers: document.getFooters(raw),
        footnotes: document.getFootnotes(raw),
        endnotes: document.getEndnotes(raw),
        /**
         * `includeBody`/`includeHeadersAndFooters` select *which* text boxes are
         * returned (those anchored in the body vs. in headers/footers), not
         * whether body text is repeated — both default true, and both are wanted.
         */
        textboxes: document.getTextboxes(raw),
      }
    } catch (error) {
      options.signal?.throwIfAborted()
      if (WORD_6_95_MAGIC_PATTERN.test(getErrorMessage(error))) {
        throw new FileParserError(
          'unsupported_type',
          'This .doc file uses a Word 6/95 format that is not supported. Save it as .docx and retry.',
          error
        )
      }
      /** word-extractor surfaces corrupt files as raw `RangeError`s; users get a stable message. */
      throw new FileParserError('invalid_format', 'This .doc file could not be read', error)
    }
    options.signal?.throwIfAborted()

    const content = sanitizeTextForUTF8(joinSections(sections))
    if (content.length === 0) {
      throw new FileParserError(
        'no_extractable_text',
        'No text could be extracted from this DOC file. Re-save it as DOCX to index it.'
      )
    }

    return {
      content,
      metadata: {
        characterCount: content.length,
        extractionMethod: 'word-extractor',
        degraded: false,
      },
    }
  }

  /** A `.docx` package saved under the wrong extension. */
  private async parseOoxmlContainer(
    buffer: Buffer,
    options: FileParseOptions
  ): Promise<FileParseResult> {
    let extracted = false
    let lastError: unknown

    try {
      const result = await parseOfficeText(buffer, options)
      extracted = true

      if (result) {
        const resultString = typeof result === 'string' ? result : String(result)
        const content = sanitizeTextForUTF8(resultString.trim())

        if (content.length > 0) {
          return {
            content,
            metadata: {
              characterCount: content.length,
              extractionMethod: 'officeparser',
            },
          }
        }
      }
    } catch (officeError) {
      options.signal?.throwIfAborted()
      lastError = officeError
      logger.warn('officeparser failed, trying mammoth:', officeError)
    }

    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      options.signal?.throwIfAborted()
      extracted = true

      if (result.value && result.value.trim().length > 0) {
        const content = sanitizeTextForUTF8(result.value.trim())
        return {
          content,
          metadata: {
            characterCount: content.length,
            extractionMethod: 'mammoth',
            messages: result.messages,
          },
        }
      }
    } catch (mammothError) {
      options.signal?.throwIfAborted()
      lastError = mammothError
      logger.warn('mammoth failed:', mammothError)
    }

    options.signal?.throwIfAborted()
    if (extracted) {
      throw new FileParserError(
        'no_extractable_text',
        'No text could be extracted from this document. Re-save it as DOCX to index it.'
      )
    }
    throw toFileParserError(lastError, 'invalid_format', 'Failed to parse DOC buffer')
  }

  /** A real text file misnamed `.doc` is a genuine extraction, not a degraded one. */
  private parsePlainText(buffer: Buffer): FileParseResult {
    const decoded = decodeTextBuffer(buffer)
    const content = sanitizeTextForUTF8(decoded.text.trim())

    if (content.length === 0) {
      throw new FileParserError('no_extractable_text', 'The file contains no text')
    }

    return {
      content,
      metadata: {
        extractionMethod: 'plaintext-fallback',
        characterCount: content.length,
        encoding: decoded.encoding,
        warning: [
          'File is not a valid DOC format, extracted as plain text',
          ...(decoded.warning ? [decoded.warning] : []),
        ].join('. '),
      },
    }
  }
}
