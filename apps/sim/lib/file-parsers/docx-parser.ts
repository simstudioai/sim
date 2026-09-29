import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { isRecordLike, toRecord } from '@sim/utils/object'
import mammoth from 'mammoth'
import {
  FileParserError,
  isEncryptedOfficeParserError,
  toFileParserError,
} from '@/lib/file-parsers/errors'
import {
  assertHtmlStringWithinLimits,
  htmlToStructuredText,
  isHtmlComplexityError,
} from '@/lib/file-parsers/html-parser'
import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'
import { isEncryptedOoxmlContainer } from '@/lib/file-parsers/ooxml-encryption'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('DocxParser')

/** Bounds repeated notes and generated markup independently of the normalized text budget. */
const MAX_DOCX_CONVERSION_NODES = 50_000
const MAX_DOCX_CONVERSION_BYTES = 2 * 1024 * 1024

/**
 * Mammoth's supported transform hook runs before HTML generation. Count every reference
 * expansion, including repeated notes, without retaining the expanded graph. The node ceiling
 * also stops cyclic references. The separate 2 MiB ceiling charges raw UTF-8 model strings,
 * including attributes, before HTML escaping. Fixed default styles and omitted image data
 * bound conversion amplification; embedded style maps could add arbitrary wrapper markup.
 */
function assertDocxConversionWithinLimits(document: unknown, signal?: AbortSignal): void {
  const notes = toRecord(toRecord(document).notes)
  const pending: unknown[] = [document]
  let nodes = 0
  let bytes = 0
  const complexity = () =>
    new FileParserError('complexity_limit', 'DOCX conversion exceeds its graph budget')
  const append = (children: unknown) => {
    if (!Array.isArray(children))
      throw new FileParserError('invalid_format', 'DOCX conversion has invalid children')
    if (nodes + pending.length + children.length > MAX_DOCX_CONVERSION_NODES) throw complexity()
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index])
  }
  while (pending.length) {
    signal?.throwIfAborted()
    const node = pending.pop()
    if (!isRecordLike(node) || typeof node.type !== 'string')
      throw new FileParserError('invalid_format', 'DOCX conversion has an invalid node')
    if (++nodes > MAX_DOCX_CONVERSION_NODES) throw complexity()
    for (const value of Object.values(node)) {
      if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8')
    }
    if (bytes > MAX_DOCX_CONVERSION_BYTES) throw complexity()
    switch (node.type) {
      case 'document':
      case 'paragraph':
      case 'run':
      case 'hyperlink':
      case 'table':
      case 'tableRow':
      case 'tableCell':
        append(node.children)
        break
      case 'note':
      case 'comment':
        append(node.body)
        break
      case 'noteReference': {
        if (typeof notes.resolve !== 'function')
          throw new FileParserError('invalid_format', 'DOCX note resolver is unavailable')
        const note: unknown = Reflect.apply(notes.resolve, notes, [node])
        if (!note) throw new FileParserError('invalid_format', 'DOCX references a missing note')
        append([note])
        break
      }
      case 'text':
        if (typeof node.value !== 'string')
          throw new FileParserError('invalid_format', 'DOCX text is malformed')
        break
      case 'image':
      case 'tab':
      case 'checkbox':
      case 'break':
      case 'bookmarkStart':
      case 'commentReference':
        break
      default:
        throw new FileParserError('invalid_format', 'DOCX conversion has an unsupported node')
    }
  }
}

/**
 * Extracts DOCX text by rendering the document to HTML with mammoth and walking
 * that HTML with the shared structured-text walker. mammoth's HTML keeps the
 * heading levels, list nesting, table rows, and footnotes that its raw-text mode
 * flattens to one paragraph per cell, so the output matches what the HTML parser
 * produces for the same document. (mammoth's Markdown mode is deprecated and
 * drops tables, so it is deliberately not used.)
 */
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
      const maxTextBytes =
        options.docxTextMode === 'complete'
          ? (options.maxTextBytes ?? MAX_DOCX_CONVERSION_BYTES)
          : undefined
      if (maxTextBytes !== undefined && (!Number.isSafeInteger(maxTextBytes) || maxTextBytes <= 0))
        throw new FileParserError('complexity_limit', 'Invalid DOCX text byte budget')

      const extractionErrors: unknown[] = []
      let parserReturnedEmpty = false

      try {
        const htmlResult = await mammoth.convertToHtml(
          { buffer },
          maxTextBytes === undefined
            ? undefined
            : {
                includeEmbeddedStyleMap: false,
                convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
                transformDocument: (document: unknown) => {
                  assertDocxConversionWithinLimits(document, options.signal)
                  return document
                },
              }
        )
        options.signal?.throwIfAborted()

        const structured = this.structuredTextFromHtml(htmlResult.value, maxTextBytes !== undefined)
        if (structured) {
          const content = sanitizeTextForUTF8(structured)
          if (maxTextBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxTextBytes)
            throw new FileParserError('complexity_limit', 'DOCX text exceeds its byte budget')
          return {
            content,
            metadata: {
              extractionMethod: 'mammoth-html',
              messages: htmlResult.messages,
            },
          }
        }

        if (maxTextBytes !== undefined)
          throw new FileParserError('no_extractable_text', 'No complete DOCX text was extracted')

        const rawResult = await mammoth.extractRawText({ buffer })
        options.signal?.throwIfAborted()

        if (rawResult.value && rawResult.value.trim().length > 0) {
          return {
            content: sanitizeTextForUTF8(rawResult.value),
            metadata: {
              extractionMethod: 'mammoth',
              messages: [...htmlResult.messages, ...rawResult.messages],
            },
          }
        }
        parserReturnedEmpty = true
      } catch (mammothError) {
        options.signal?.throwIfAborted()
        if (maxTextBytes !== undefined) throw mammothError
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

      if (isEncryptedOoxmlContainer(buffer)) {
        throw new FileParserError(
          'encrypted_file',
          'This document is encrypted or password-protected',
          extractionErrors.length > 0 ? new AggregateError(extractionErrors) : undefined
        )
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

  /**
   * Walks mammoth's HTML rendering under the HTML parser's size caps. A rendering
   * too large to walk safely falls back to the raw-text path by returning empty,
   * since mammoth has already materialised the document once at that point. Budgeted reads
   * reject instead: the fallback cannot preserve the conversion and completeness bounds.
   */
  private structuredTextFromHtml(html: string, bounded = false): string {
    if (!html || html.trim().length === 0) return ''
    try {
      assertHtmlStringWithinLimits(html)
    } catch (error) {
      if (isHtmlComplexityError(error)) {
        if (bounded) throw error
        logger.warn('mammoth HTML exceeds walker limits, using raw text:', error.message)
        return ''
      }
      throw error
    }
    return htmlToStructuredText(html).trim()
  }
}
