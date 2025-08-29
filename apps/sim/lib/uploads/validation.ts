import path from 'path'

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'txt',
  'md',
  'xlsx',
  'xls',
] as const

export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number]

export const SUPPORTED_MIME_TYPES: Record<SupportedDocumentExtension, string[]> = {
  pdf: ['application/pdf'],
  csv: ['text/csv', 'application/csv'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/x-markdown'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
}

export interface FileValidationError {
  code: 'UNSUPPORTED_FILE_TYPE' | 'MIME_TYPE_MISMATCH'
  message: string
  supportedTypes: string[]
}

/**
 * Validate if a file type is supported for document processing
 */
export function validateFileType(fileName: string, mimeType: string): FileValidationError | null {
  const extension = path.extname(fileName).toLowerCase().substring(1) as SupportedDocumentExtension

  if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    return {
      code: 'UNSUPPORTED_FILE_TYPE',
      message: `Unsupported file type: ${extension}. Supported types are: ${SUPPORTED_DOCUMENT_EXTENSIONS.join(', ')}`,
      supportedTypes: [...SUPPORTED_DOCUMENT_EXTENSIONS],
    }
  }

  const allowedMimeTypes = SUPPORTED_MIME_TYPES[extension]
  if (!allowedMimeTypes.includes(mimeType)) {
    return {
      code: 'MIME_TYPE_MISMATCH',
      message: `MIME type ${mimeType} does not match file extension ${extension}. Expected: ${allowedMimeTypes.join(', ')}`,
      supportedTypes: allowedMimeTypes,
    }
  }

  return null
}

/**
 * Check if file extension is supported
 */
export function isSupportedExtension(extension: string): extension is SupportedDocumentExtension {
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(
    extension.toLowerCase() as SupportedDocumentExtension
  )
}

/**
 * Get supported MIME types for an extension
 */
export function getSupportedMimeTypes(extension: string): string[] {
  if (isSupportedExtension(extension)) {
    return SUPPORTED_MIME_TYPES[extension as SupportedDocumentExtension]
  }
  return []
}
