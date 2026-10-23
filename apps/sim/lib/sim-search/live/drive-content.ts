import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { FileParserError, getFileParserErrorCode } from '@/lib/file-parsers/errors'
import { sniffFileKind } from '@/lib/file-parsers/sniff'
import type { FileParseResult } from '@/lib/file-parsers/types'
import {
  assertOoxmlArchiveWithinLimits,
  DEFAULT_OOXML_SIZE_LIMITS,
} from '@/lib/file-parsers/zip-guard'
import { NATIVE_RESPONSE_MAX_BYTES, NativeSearchError, segment } from '@/lib/sim-search/live/http'
import type { NativeClient } from '@/lib/sim-search/live/types'

const MAX_DRIVE_TEXT_BYTES = 1024 * 1024
const MAX_DRIVE_PDF_PAGES = 100
const DRIVE_DOCX_LIMITS = {
  ...DEFAULT_OOXML_SIZE_LIMITS,
  maxTotalUncompressedBytes: 10 * 1024 * 1024,
  maxEntryUncompressedBytes: 4 * 1024 * 1024,
}

/** Extracts bounded text from the exact downloadable PDF or DOCX identified by Drive metadata. */
export async function readDriveFileContent(
  client: NativeClient,
  id: string,
  row: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  if (row.id !== id)
    throw new NativeSearchError(
      'unavailable',
      'Drive returned a different file. Search again before reading it.'
    )
  if (toRecord(row.capabilities).canDownload !== true)
    throw new NativeSearchError(
      'unavailable',
      'Drive does not allow downloading this file. Ask the owner to allow downloads or open the source.'
    )
  const mimeType = toStringOrNull(row.mimeType)
  const extension =
    mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ? 'docx'
        : undefined
  if (!extension)
    throw new NativeSearchError(
      'unavailable',
      'This file type does not support binary text reads. Open the source.'
    )
  if (row.size !== undefined) {
    const size = toStringOrNull(row.size)
    if (!size || !/^\d{1,20}$/.test(size))
      throw new NativeSearchError(
        'unavailable',
        'Drive returned an invalid file size. Refresh the source and retry.'
      )
    if (Number(size) > NATIVE_RESPONSE_MAX_BYTES)
      throw new NativeSearchError(
        'unavailable',
        'This file exceeds the 4 MiB live-read limit. Split it into smaller files or open the source.'
      )
  }

  let bytes: Buffer
  try {
    bytes = await client.bytes(`/drive/v3/files/${segment(id)}`, {
      alt: 'media',
      supportsAllDrives: 'true',
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error))
      throw new NativeSearchError(
        'unavailable',
        'This file exceeds the 4 MiB live-read limit. Split it into smaller files or open the source.'
      )
    throw error
  }
  signal?.throwIfAborted()
  try {
    if (bytes.byteLength === 0) throw new FileParserError('empty_input', 'Empty file')
    if (bytes.byteLength > NATIVE_RESPONSE_MAX_BYTES)
      throw new FileParserError('complexity_limit', 'File exceeds the binary read limit')
    const kind = sniffFileKind(bytes, extension)
    if (kind === 'encrypted-ooxml')
      throw new FileParserError('encrypted_file', 'Encrypted document')
    if (kind !== extension)
      throw new FileParserError('invalid_format', 'File content does not match its Drive MIME type')

    let parsed: FileParseResult
    if (extension === 'pdf') {
      const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')
      parsed = await new PdfParser().parseBuffer(bytes, {
        signal,
        pdfTextMode: 'complete',
        pdfMaxPages: MAX_DRIVE_PDF_PAGES,
        maxTextBytes: MAX_DRIVE_TEXT_BYTES,
      })
    } else {
      assertOoxmlArchiveWithinLimits(bytes, DRIVE_DOCX_LIMITS)
      const { DocxParser } = await import('@/lib/file-parsers/docx-parser')
      parsed = await new DocxParser().parseBuffer(bytes, {
        signal,
        docxTextMode: 'complete',
        maxTextBytes: MAX_DRIVE_TEXT_BYTES,
      })
    }
    signal?.throwIfAborted()
    if (parsed.metadata?.degraded || parsed.metadata?.truncated)
      throw new FileParserError('complexity_limit', 'Complete document text was not extracted')
    if (!parsed.content.trim())
      throw new FileParserError('no_extractable_text', 'No document text was extracted')
    if (Buffer.byteLength(parsed.content, 'utf8') > MAX_DRIVE_TEXT_BYTES)
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
