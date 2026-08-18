import { isSupportedFileType } from '@/lib/file-parsers'
import {
  extractStorageKey,
  getExtensionFromMimeType,
  getFileExtension,
  isInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import {
  isAlphanumericExtension,
  isSupportedExtension,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from '@/lib/uploads/utils/validation'

const SUPPORTED_EXTENSIONS_TEXT = SUPPORTED_DOCUMENT_EXTENSIONS.join(', ')

export function resolveParserExtension(
  filename: string,
  mimeType?: string,
  fallback?: string
): string {
  const raw = getFileExtension(filename)
  const filenameExtension = isAlphanumericExtension(raw) ? raw : undefined

  if (filenameExtension && isSupportedExtension(filenameExtension)) {
    return filenameExtension
  }

  const mimeExtension = mimeType ? getExtensionFromMimeType(mimeType) : undefined
  if (mimeExtension && isSupportedExtension(mimeExtension)) {
    return mimeExtension
  }

  if (fallback) {
    return fallback
  }

  if (filenameExtension) {
    throw new Error(
      `Unsupported file type: ${filenameExtension}. Supported types are: ${SUPPORTED_EXTENSIONS_TEXT}`
    )
  }

  throw new Error(`Could not determine file type for ${filename || 'document'}`)
}

/**
 * Extension of the object actually stored, taken from its storage key.
 *
 * A knowledge base document's `filename` is a *display* name, and for connector
 * documents it deliberately disagrees with the bytes on disk: the sync engine
 * records the source file's name (`Report.pdf`) while storing the text the
 * connector already extracted from it under a `.txt` key. Choosing a parser from
 * the display name therefore re-parses extracted text as the original binary
 * format — `Invalid PDF structure.` for PDFs, and for spreadsheets a silent
 * double-wrap, since SheetJS accepts almost anything.
 *
 * The storage key is the honest signal for both ingestion paths, because
 * `fitStorageKeyName` preserves a file's extension through truncation: an upload
 * keys on its original name (`kb/<id>-Report.pdf`) and a connector document keys
 * on what it stored (`kb/<id>-Report.pdf.txt`).
 *
 * Validated against the parser registry rather than the upload allowlist, because
 * the question here is whether a parser can read the stored object — not whether
 * we would accept it as an upload. The two sets differ: macro-enabled, template
 * and OpenDocument formats all parse, but are deliberately not offered as upload
 * types, and a connector delivers exactly those.
 *
 * Falls back to `undefined` — leaving the caller on the filename/MIME path —
 * rather than guessing, so this can only ever redirect to a parser that exists.
 */
export function resolveStoredArtifactExtension(fileUrl: string): string | undefined {
  if (!isInternalFileUrl(fileUrl)) return undefined

  const extension = getFileExtension(extractStorageKey(fileUrl))
  if (!isAlphanumericExtension(extension)) return undefined

  return isSupportedFileType(extension) ? extension : undefined
}
