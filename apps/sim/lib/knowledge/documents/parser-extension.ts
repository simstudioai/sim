import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'
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
  const raw = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined
  const filenameExtension = raw && isAlphanumericExtension(raw) ? raw : undefined

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
