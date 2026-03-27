import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'

const SUPPORTED_FILE_TYPES = [
  'pdf',
  'csv',
  'docx',
  'doc',
  'txt',
  'md',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'html',
  'htm',
  'json',
  'yaml',
  'yml',
] as const

const SUPPORTED_FILE_TYPES_TEXT = SUPPORTED_FILE_TYPES.join(', ')

function isSupportedParserExtension(extension: string): boolean {
  return SUPPORTED_FILE_TYPES.includes(extension as (typeof SUPPORTED_FILE_TYPES)[number])
}

export function resolveParserExtension(
  filename: string,
  mimeType?: string,
  fallback?: string
): string {
  const raw = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined
  const filenameExtension = raw && /^[a-z0-9]+$/.test(raw) ? raw : undefined

  if (filenameExtension && isSupportedParserExtension(filenameExtension)) {
    return filenameExtension
  }

  const mimeExtension = mimeType ? getExtensionFromMimeType(mimeType) : undefined
  if (mimeExtension && isSupportedParserExtension(mimeExtension)) {
    return mimeExtension
  }

  if (fallback) {
    return fallback
  }

  if (filenameExtension) {
    throw new Error(
      `Unsupported file type: ${filenameExtension}. Supported types are: ${SUPPORTED_FILE_TYPES_TEXT}`
    )
  }

  throw new Error(`Could not determine file type for ${filename || 'document'}`)
}
