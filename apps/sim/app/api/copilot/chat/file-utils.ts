export interface FileAttachment {
  id: string
  s3_key: string
  filename: string
  media_type: string
  size: number
}

export interface AnthropicMessageContent {
  type: 'text' | 'image' | 'document'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
}

/**
 * Mapping of MIME types to Anthropic content types
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
 * Get the Anthropic content type for a given MIME type
 */
export function getAnthropicContentType(mimeType: string): 'image' | 'document' | null {
  return MIME_TYPE_MAPPING[mimeType.toLowerCase()] || null
}

/**
 * Check if a MIME type is supported by Anthropic
 */
export function isSupportedFileType(mimeType: string): boolean {
  return mimeType.toLowerCase() in MIME_TYPE_MAPPING
}

/**
 * Convert a file buffer to base64
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64')
}

/**
 * Create Anthropic message content from file data
 */
export function createAnthropicFileContent(
  fileBuffer: Buffer,
  mimeType: string
): AnthropicMessageContent | null {
  const contentType = getAnthropicContentType(mimeType)
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
