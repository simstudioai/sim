import { existsSync } from 'fs'
import path from 'path'
import { createLogger } from '@sim/logger'
import { CsvParser } from '@/lib/file-parsers/csv-parser'
import { DocParser } from '@/lib/file-parsers/doc-parser'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { FileParserError } from '@/lib/file-parsers/errors'
import { HtmlParser } from '@/lib/file-parsers/html-parser'
import {
  parseJSON,
  parseJSONBuffer,
  parseJSONL,
  parseJSONLBuffer,
} from '@/lib/file-parsers/json-parser'
import { MdParser } from '@/lib/file-parsers/md-parser'
import { OpenDocumentParser } from '@/lib/file-parsers/opendocument-parser'
import { PdfParser } from '@/lib/file-parsers/pdf-parser'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'
import { TxtParser } from '@/lib/file-parsers/txt-parser'
import type {
  FileParseOptions,
  FileParseResult,
  FileParser,
  SupportedFileType,
} from '@/lib/file-parsers/types'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'
import { parseYAML, parseYAMLBuffer } from '@/lib/file-parsers/yaml-parser'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

const logger = createLogger('FileParser')

/**
 * Extension → parser. Several extensions deliberately share one parser because
 * they are the same container:
 *
 * - `docm`/`dotx` are the WordprocessingML package `docx` uses; mammoth reads
 *   `word/document.xml` without consulting the package's content type.
 * - `xlsm`/`xlsb`/`xltx`/`xls`/`ods` are all read natively by SheetJS. `ods` is
 *   treated as a spreadsheet rather than routed to {@link OpenDocumentParser} so
 *   its output keeps per-sheet structure instead of one flat text run.
 * - `pptm`/`potx` are the PresentationML package `pptx` uses. `ppt` is the legacy
 *   OLE binary that no bundled library reads; it is mapped here so it degrades
 *   through the parser's own reporting rather than looking simply unsupported.
 *
 * Every parser module is imported statically and every dependency is a regular
 * (non-optional) one, so a broken install fails loudly at import. This previously
 * used `require()` inside per-parser `try/catch` blocks that only logged, which
 * meant a resolution failure produced a silently **empty** registry and turned
 * every format into `Unsupported file type` — an outcome indistinguishable from a
 * genuinely unsupported extension. The heavy extraction libraries are still loaded
 * on demand inside the individual parsers.
 *
 * A `Map` rather than an object literal: the extension is caller-supplied, and a
 * plain object would resolve inherited keys, so `PARSERS['constructor']` would hand
 * back `Object` and route the request to a "parser" with no parse methods.
 */
const PARSERS = new Map<string, FileParser>([
  ['pdf', new PdfParser()],
  ['csv', new CsvParser()],
  ['doc', new DocParser()],
  ['docx', new DocxParser()],
  ['docm', new DocxParser()],
  ['dotx', new DocxParser()],
  ['txt', new TxtParser()],
  ['md', new MdParser()],
  ['xlsx', new XlsxParser()],
  ['xls', new XlsxParser()],
  ['xlsm', new XlsxParser()],
  ['xlsb', new XlsxParser()],
  ['xltx', new XlsxParser()],
  ['ods', new XlsxParser()],
  ['pptx', new PptxParser()],
  ['ppt', new PptxParser()],
  ['pptm', new PptxParser()],
  ['potx', new PptxParser()],
  ['odt', new OpenDocumentParser()],
  ['odp', new OpenDocumentParser()],
  ['html', new HtmlParser()],
  ['htm', new HtmlParser()],
  ['json', { parseFile: parseJSON, parseBuffer: parseJSONBuffer }],
  ['jsonl', { parseFile: parseJSONL, parseBuffer: parseJSONLBuffer }],
  ['yaml', { parseFile: parseYAML, parseBuffer: parseYAMLBuffer }],
  ['yml', { parseFile: parseYAML, parseBuffer: parseYAMLBuffer }],
])

/** Extensions with a registered parser, for error messages. */
const SUPPORTED_EXTENSIONS_TEXT = [...PARSERS.keys()].join(', ')

/**
 * Parse a file based on its extension
 * @param filePath Path to the file
 * @param options Cancellation options for parsers that support them
 * @returns Parsed content and metadata
 */
export async function parseFile(
  filePath: string,
  options: FileParseOptions = {}
): Promise<FileParseResult> {
  try {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const extension = path.extname(filePath).toLowerCase().substring(1)
    const parser = PARSERS.get(extension)

    if (!parser) {
      throw new Error(
        `Unsupported file type: ${extension}. Supported types are: ${SUPPORTED_EXTENSIONS_TEXT}`
      )
    }

    return await parser.parseFile(filePath, options)
  } catch (error) {
    logger.error('File parsing error:', error)
    throw error
  }
}

/**
 * Parse a buffer based on file extension
 * @param buffer Buffer containing the file data
 * @param extension File extension without the dot (e.g., 'pdf', 'csv')
 * @param options Cancellation options for parsers that support them
 * @returns Parsed content and metadata
 *
 * The zip-bomb guard runs here for every extension, not just the OOXML ones:
 * the extension is an attacker-controlled routing hint, and the guard no-ops
 * for buffers that are not ZIP archives. Individual parsers still call it so a
 * direct `parser.parseBuffer` caller is covered too.
 */
export async function parseBuffer(
  buffer: Buffer,
  extension: string,
  options: FileParseOptions = {}
): Promise<FileParseResult> {
  try {
    if (!buffer || buffer.length === 0) {
      throw new FileParserError('empty_input', 'Empty buffer provided')
    }

    if (!extension) {
      throw new Error('No file extension provided')
    }

    assertOoxmlArchiveWithinLimits(buffer)

    const normalizedExtension = extension.toLowerCase()
    const parser = PARSERS.get(normalizedExtension)

    if (!parser) {
      throw new FileParserError(
        'unsupported_type',
        `Unsupported file type: ${normalizedExtension}. Supported types are: ${SUPPORTED_EXTENSIONS_TEXT}`
      )
    }

    if (!parser.parseBuffer) {
      throw new FileParserError(
        'unsupported_type',
        `Parser for ${normalizedExtension} does not support buffer parsing`
      )
    }

    return await parser.parseBuffer(buffer, options)
  } catch (error) {
    logger.error('Buffer parsing error:', error)
    throw error
  }
}

/**
 * Check if a file type is supported
 * @param extension File extension without the dot
 * @returns true if supported, false otherwise
 */
export function isSupportedFileType(extension: string): extension is SupportedFileType {
  return typeof extension === 'string' && PARSERS.has(extension.toLowerCase())
}

export type { FileParseOptions, FileParseResult, SupportedFileType }
