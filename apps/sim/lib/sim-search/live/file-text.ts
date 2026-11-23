import { FileParserError, getFileParserErrorCode } from '@/lib/file-parsers/errors'
import { sniffFileKind } from '@/lib/file-parsers/sniff'
import type { FileParseResult } from '@/lib/file-parsers/types'
import {
  assertOoxmlArchiveWithinLimits,
  DEFAULT_OOXML_SIZE_LIMITS,
} from '@/lib/file-parsers/zip-guard'
import { NATIVE_RESPONSE_MAX_BYTES, NativeSearchError } from '@/lib/sim-search/live/http'

/** Extracted text one live file read may return. */
export const MAX_FILE_TEXT_BYTES = 1024 * 1024
const MAX_FILE_PDF_PAGES = 100
const FILE_DOCX_LIMITS = {
  ...DEFAULT_OOXML_SIZE_LIMITS,
  maxTotalUncompressedBytes: 10 * 1024 * 1024,
  maxEntryUncompressedBytes: 4 * 1024 * 1024,
}

/** The document format `extractDocumentText` reads for a provider-declared MIME type. */
export function documentExtension(mimeType: string | null | undefined): 'pdf' | 'docx' | undefined {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return 'docx'
  return undefined
}

/**
 * Extracts the complete, bounded text of a downloaded PDF or DOCX whose bytes must match the type
 * its provider declared. Every failure is a NativeSearchError naming what the reader can do.
 */
export async function extractDocumentText(
  bytes: Buffer,
  extension: 'pdf' | 'docx',
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  try {
    if (bytes.byteLength === 0) throw new FileParserError('empty_input', 'Empty file')
    if (bytes.byteLength > NATIVE_RESPONSE_MAX_BYTES)
      throw new FileParserError('complexity_limit', 'File exceeds the binary read limit')
    const kind = sniffFileKind(bytes, extension)
    if (kind === 'encrypted-ooxml')
      throw new FileParserError('encrypted_file', 'Encrypted document')
    if (kind !== extension)
      throw new FileParserError('invalid_format', 'File content does not match its declared type')

    let parsed: FileParseResult
    if (extension === 'pdf') {
      const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')
      parsed = await new PdfParser().parseBuffer(bytes, {
        signal,
        pdfTextMode: 'complete',
        pdfMaxPages: MAX_FILE_PDF_PAGES,
        maxTextBytes: MAX_FILE_TEXT_BYTES,
      })
    } else {
      assertOoxmlArchiveWithinLimits(bytes, FILE_DOCX_LIMITS)
      const { DocxParser } = await import('@/lib/file-parsers/docx-parser')
      parsed = await new DocxParser().parseBuffer(bytes, {
        signal,
        docxTextMode: 'complete',
        maxTextBytes: MAX_FILE_TEXT_BYTES,
      })
    }
    signal?.throwIfAborted()
    if (parsed.metadata?.degraded || parsed.metadata?.truncated)
      throw new FileParserError('complexity_limit', 'Complete document text was not extracted')
    if (!parsed.content.trim())
      throw new FileParserError('no_extractable_text', 'No document text was extracted')
    if (Buffer.byteLength(parsed.content, 'utf8') > MAX_FILE_TEXT_BYTES)
      throw new FileParserError('complexity_limit', 'Extracted text exceeds the live-read limit')
    return parsed.content
  } catch (error) {
    signal?.throwIfAborted()
    switch (getFileParserErrorCode(error)) {
      case 'encrypted_file':
        throw new NativeSearchError(
          'unavailable',
          'This file is password-protected. Remove the password from a copy or open the source.'
        )
      case 'empty_input':
      case 'no_extractable_text':
        throw new NativeSearchError(
          'unavailable',
          'No text could be extracted from this file. Image-only scans require OCR; open the source or provide a searchable copy.'
        )
      case 'complexity_limit':
        throw new NativeSearchError(
          'unavailable',
          'This file exceeds live text extraction limits. Split it into smaller files or open the source.'
        )
      case 'invalid_format':
      case 'unsupported_type':
        throw new NativeSearchError(
          'unavailable',
          'The file content is malformed or does not match its PDF or DOCX type. Re-save it in a supported format or open the source.'
        )
      default:
        throw new NativeSearchError(
          'unavailable',
          'The file could not be read as text. Retry or open the source.'
        )
    }
  }
}
