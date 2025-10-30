import type { Logger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads'
import type { UserFile } from '@/executor/types'
import { ACCEPTED_FILE_TYPES } from './validation'

export interface FileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

export interface MessageContent {
  type: 'text' | 'image' | 'document'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

/**
 * Mapping of MIME types to content types
 */
export const MIME_TYPE_MAPPING: Record<string, 'image' | 'document'> = {
  // Images
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',

  // Documents
  'application/pdf': 'document',
  'text/plain': 'document',
  'text/csv': 'document',
  'application/json': 'document',
  'application/xml': 'document',
  'text/xml': 'document',
  'text/html': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document', // .pptx
  'application/msword': 'document', // .doc
  'application/vnd.ms-excel': 'document', // .xls
  'application/vnd.ms-powerpoint': 'document', // .ppt
  'text/markdown': 'document',
  'application/rtf': 'document',
}

/**
 * Get the content type for a given MIME type
 */
export function getContentType(mimeType: string): 'image' | 'document' | null {
  return MIME_TYPE_MAPPING[mimeType.toLowerCase()] || null
}

/**
 * Check if a MIME type is supported
 */
export function isSupportedFileType(mimeType: string): boolean {
  return mimeType.toLowerCase() in MIME_TYPE_MAPPING
}

/**
 * Check if a MIME type is an image type (for copilot uploads)
 */
export function isImageFileType(mimeType: string): boolean {
  const imageTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ]
  return imageTypes.includes(mimeType.toLowerCase())
}

/**
 * Convert a file buffer to base64
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64')
}

/**
 * Create message content from file data
 */
export function createFileContent(fileBuffer: Buffer, mimeType: string): MessageContent | null {
  const contentType = getContentType(mimeType)
  if (!contentType) {
    return null
  }

  return {
    type: contentType,
    source: {
      type: 'base64',
      media_type: mimeType,
      data: bufferToBase64(fileBuffer),
    },
  }
}

/**
 * Extract file extension from filename
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : ''
}

/**
 * Get MIME type from file extension (fallback if not provided)
 */
export function getMimeTypeFromExtension(extension: string): string {
  const extensionMimeMap: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',

    // Documents
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    htm: 'text/html',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword',
    xls: 'application/vnd.ms-excel',
    ppt: 'application/vnd.ms-powerpoint',
    md: 'text/markdown',
    rtf: 'application/rtf',
  }

  return extensionMimeMap[extension.toLowerCase()] || 'application/octet-stream'
}

/**
 * Format bytes to human-readable file size
 * @param bytes - File size in bytes
 * @param options - Formatting options
 * @returns Formatted string (e.g., "1.5 MB", "500 KB")
 */
export function formatFileSize(
  bytes: number,
  options?: { includeBytes?: boolean; precision?: number }
): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const precision = options?.precision ?? 1
  const includeBytes = options?.includeBytes ?? false

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  if (i === 0 && !includeBytes) {
    return '0 Bytes'
  }

  const value = bytes / k ** i
  const formattedValue = Number.parseFloat(value.toFixed(precision))

  return `${formattedValue} ${sizes[i]}`
}

/**
 * Validate file size and type for knowledge base uploads (client-side)
 * @param file - File object to validate
 * @param maxSizeBytes - Maximum file size in bytes (default: 100MB)
 * @returns Error message string if validation fails, null if valid
 */
export function validateKnowledgeBaseFile(
  file: File,
  maxSizeBytes: number = 100 * 1024 * 1024
): string | null {
  if (file.size > maxSizeBytes) {
    const maxSizeMB = Math.round(maxSizeBytes / (1024 * 1024))
    return `File "${file.name}" is too large. Maximum size is ${maxSizeMB}MB.`
  }

  if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
    return `File "${file.name}" has an unsupported format. Please use PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, MD, PPT, PPTX, HTML, JSON, YAML, or YML files.`
  }

  return null
}

/**
 * Extract storage key from a file path
 */
export function extractStorageKey(filePath: string): string {
  const pathWithoutQuery = filePath.split('?')[0]

  if (pathWithoutQuery.includes('/api/files/serve/s3/')) {
    return decodeURIComponent(pathWithoutQuery.split('/api/files/serve/s3/')[1])
  }
  if (pathWithoutQuery.includes('/api/files/serve/blob/')) {
    return decodeURIComponent(pathWithoutQuery.split('/api/files/serve/blob/')[1])
  }
  if (pathWithoutQuery.startsWith('/api/files/serve/')) {
    return decodeURIComponent(pathWithoutQuery.substring('/api/files/serve/'.length))
  }
  return pathWithoutQuery
}

/**
 * Check if a URL is an internal file serve URL
 */
export function isInternalFileUrl(fileUrl: string): boolean {
  return fileUrl.includes('/api/files/serve/')
}

/**
 * Infer storage context from file key pattern
 */
export function inferContextFromKey(key: string): StorageContext {
  // KB files always start with 'kb/' prefix
  if (key.startsWith('kb/')) {
    return 'knowledge-base'
  }

  // Execution files: three or more UUID segments (workspace/workflow/execution/...)
  // Pattern: {uuid}/{uuid}/{uuid}/{filename}
  const segments = key.split('/')
  if (segments.length >= 4 && segments[0].match(/^[a-f0-9-]{36}$/)) {
    return 'execution'
  }

  // Workspace files: UUID-like ID followed by timestamp pattern
  // Pattern: {uuid}/{timestamp}-{random}-{filename}
  if (key.match(/^[a-f0-9-]{36}\/\d+-[a-z0-9]+-/)) {
    return 'workspace'
  }

  // Copilot/General files: timestamp-random-filename (no path segments)
  // Pattern: {timestamp}-{random}-{filename}
  // NOTE: This is ambiguous - prefer explicit context parameter
  if (key.match(/^\d+-[a-z0-9]+-/)) {
    return 'general'
  }

  return 'general'
}

/**
 * Extract storage key and context from an internal file URL
 * @param fileUrl - Internal file URL (e.g., /api/files/serve/key?context=workspace)
 * @param defaultContext - Default context if not found in URL params
 * @returns Object with storage key and context
 */
export function parseInternalFileUrl(
  fileUrl: string,
  defaultContext: StorageContext = 'general'
): { key: string; context: StorageContext } {
  const key = extractStorageKey(fileUrl)

  if (!key) {
    throw new Error('Could not extract storage key from internal file URL')
  }

  const url = new URL(fileUrl.startsWith('http') ? fileUrl : `http://localhost${fileUrl}`)
  const contextParam = url.searchParams.get('context')

  const context = (contextParam as StorageContext) || inferContextFromKey(key) || defaultContext

  return { key, context }
}

/**
 * Raw file input that can be converted to UserFile
 * Supports various file object formats from different sources
 */
export interface RawFileInput {
  id?: string
  key?: string
  path?: string
  url?: string
  name: string
  size: number
  type?: string
  uploadedAt?: string | Date
  expiresAt?: string | Date
  [key: string]: unknown // Allow additional properties for flexibility
}

/**
 * Converts a single raw file object to UserFile format
 * @param file - Raw file object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns UserFile object
 * @throws Error if file has no storage key
 */
export function processSingleFileToUserFile(
  file: RawFileInput,
  requestId: string,
  logger: Logger
): UserFile {
  if (file.id && file.key && file.uploadedAt) {
    return file as UserFile
  }

  const storageKey = file.key || (file.path ? extractStorageKey(file.path) : null)

  if (!storageKey) {
    logger.warn(`[${requestId}] File has no storage key: ${file.name || 'unknown'}`)
    throw new Error(`File has no storage key: ${file.name || 'unknown'}`)
  }

  const userFile: UserFile = {
    id: file.id || `file-${Date.now()}`,
    name: file.name,
    url: file.url || file.path || '',
    size: file.size,
    type: file.type || 'application/octet-stream',
    key: storageKey,
    uploadedAt: file.uploadedAt
      ? typeof file.uploadedAt === 'string'
        ? file.uploadedAt
        : file.uploadedAt.toISOString()
      : new Date().toISOString(),
    expiresAt: file.expiresAt
      ? typeof file.expiresAt === 'string'
        ? file.expiresAt
        : file.expiresAt.toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  logger.info(`[${requestId}] Converted file to UserFile: ${userFile.name} (key: ${userFile.key})`)
  return userFile
}

/**
 * Converts raw file objects (from file-upload or variable references) to UserFile format
 * @param files - Array of raw file objects
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns Array of UserFile objects
 */
export function processFilesToUserFiles(
  files: RawFileInput[],
  requestId: string,
  logger: Logger
): UserFile[] {
  const userFiles: UserFile[] = []

  for (const file of files) {
    try {
      const userFile = processSingleFileToUserFile(file, requestId, logger)
      userFiles.push(userFile)
    } catch (error) {
      logger.warn(
        `[${requestId}] Skipping file: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  return userFiles
}

/**
 * Sanitize a filename for use in storage metadata headers
 * Storage metadata headers must contain only ASCII printable characters (0x20-0x7E)
 * and cannot contain certain special characters
 */
export function sanitizeFilenameForMetadata(filename: string): string {
  return (
    filename
      // Remove non-ASCII characters (keep only printable ASCII 0x20-0x7E)
      .replace(/[^\x20-\x7E]/g, '')
      // Remove characters that are problematic in HTTP headers
      .replace(/["\\]/g, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim() ||
    // Provide fallback if completely sanitized
    'file'
  )
}

/**
 * Sanitize metadata values for storage providers
 * Removes non-printable ASCII characters and limits length
 * @param metadata Original metadata object
 * @param maxLength Maximum length per value (Azure Blob: 8000, S3: 2000)
 * @returns Sanitized metadata object
 */
export function sanitizeStorageMetadata(
  metadata: Record<string, string>,
  maxLength: number
): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const sanitizedValue = String(value)
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/["\\]/g, '')
      .substring(0, maxLength)
    if (sanitizedValue) {
      sanitized[key] = sanitizedValue
    }
  }
  return sanitized
}

/**
 * Sanitize a file key/path for local storage
 * Removes dangerous characters and prevents path traversal
 * @param key Original file key/path
 * @returns Sanitized key safe for filesystem use
 */
export function sanitizeFileKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.\./g, '')
}
