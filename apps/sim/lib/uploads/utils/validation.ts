import path from 'path'

export const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'txt',
  'md',
  'xlsx',
  'xls',
  'ppt',
  'pptx',
  'html',
  'htm',
  'json',
  'yaml',
  'yml',
] as const

export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number]

export const SUPPORTED_MIME_TYPES: Record<SupportedDocumentExtension, string[]> = {
  pdf: ['application/pdf', 'application/x-pdf'],
  csv: ['text/csv', 'application/csv', 'text/comma-separated-values'],
  doc: ['application/msword', 'application/doc', 'application/vnd.ms-word'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ],
  txt: ['text/plain', 'text/x-plain', 'application/txt'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain', 'application/markdown'],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
  xls: [
    'application/vnd.ms-excel',
    'application/excel',
    'application/x-excel',
    'application/x-msexcel',
  ],
  ppt: ['application/vnd.ms-powerpoint', 'application/powerpoint', 'application/x-mspowerpoint'],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream',
  ],
  html: ['text/html', 'application/xhtml+xml'],
  htm: ['text/html', 'application/xhtml+xml'],
  json: ['application/json', 'text/json', 'application/x-json'],
  yaml: ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'],
  yml: ['text/yaml', 'text/x-yaml', 'application/yaml', 'application/x-yaml'],
}

export const ACCEPTED_FILE_TYPES = Object.values(SUPPORTED_MIME_TYPES).flat()

export const ACCEPTED_FILE_EXTENSIONS = SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`)

export const ACCEPT_ATTRIBUTE = [...ACCEPTED_FILE_TYPES, ...ACCEPTED_FILE_EXTENSIONS].join(',')

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

  const baseMimeType = mimeType.split(';')[0].trim()

  const allowedMimeTypes = SUPPORTED_MIME_TYPES[extension]
  if (!allowedMimeTypes.includes(baseMimeType)) {
    return {
      code: 'MIME_TYPE_MISMATCH',
      message: `MIME type ${baseMimeType} does not match file extension ${extension}. Expected: ${allowedMimeTypes.join(', ')}`,
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
