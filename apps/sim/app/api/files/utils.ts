import { existsSync } from 'fs'
import { join, resolve, sep } from 'path'
import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { UPLOAD_DIR } from '@/lib/uploads/setup'

const logger = createLogger('FilesUtils')

/**
 * Response type definitions
 */
export interface ApiSuccessResponse {
  success: true
  [key: string]: any
}

export interface ApiErrorResponse {
  error: string
  message?: string
}

export interface FileResponse {
  buffer: Buffer
  contentType: string
  filename: string
}

/**
 * Custom error types
 */
export class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRequestError'
  }
}

/**
 * Maps file extensions to MIME types
 */
export const contentTypeMap: Record<string, string> = {
  // Text formats
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
  // Document formats
  pdf: 'application/pdf',
  googleDoc: 'application/vnd.google-apps.document',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Spreadsheet formats
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  googleSheet: 'application/vnd.google-apps.spreadsheet',
  // Presentation formats
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Image formats
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  // Archive formats
  zip: 'application/zip',
  // Folder format
  googleFolder: 'application/vnd.google-apps.folder',
}

/**
 * List of binary file extensions
 */
export const binaryExtensions = [
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'pdf',
]

/**
 * Determine content type from file extension
 */
export function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return contentTypeMap[extension] || 'application/octet-stream'
}

/**
 * Check if a path is an S3 path
 */
export function isS3Path(path: string): boolean {
  return path.includes('/api/files/serve/s3/')
}

/**
 * Check if a path is a Blob path
 */
export function isBlobPath(path: string): boolean {
  return path.includes('/api/files/serve/blob/')
}

/**
 * Check if a path points to cloud storage (S3, Blob, or generic cloud)
 */
export function isCloudPath(path: string): boolean {
  return isS3Path(path) || isBlobPath(path)
}

/**
 * Generic function to extract storage key from a path
 */
export function extractStorageKey(path: string, storageType: 's3' | 'blob'): string {
  const prefix = `/api/files/serve/${storageType}/`
  if (path.includes(prefix)) {
    return decodeURIComponent(path.split(prefix)[1])
  }
  return path
}

/**
 * Extract S3 key from a path
 */
export function extractS3Key(path: string): string {
  return extractStorageKey(path, 's3')
}

/**
 * Extract Blob key from a path
 */
export function extractBlobKey(path: string): string {
  return extractStorageKey(path, 'blob')
}

/**
 * Extract filename from a serve path
 */
export function extractFilename(path: string): string {
  let filename: string

  if (path.startsWith('/api/files/serve/')) {
    filename = path.substring('/api/files/serve/'.length)
  } else {
    filename = path.split('/').pop() || path
  }

  filename = filename
    .replace(/\.\./g, '')
    .replace(/\/\.\./g, '')
    .replace(/\.\.\//g, '')

  // Handle cloud storage paths (s3/key, blob/key) - preserve forward slashes for these
  if (filename.startsWith('s3/') || filename.startsWith('blob/')) {
    // For cloud paths, only sanitize the key portion after the prefix
    const parts = filename.split('/')
    const prefix = parts[0] // 's3' or 'blob'
    const keyParts = parts.slice(1)

    // Sanitize each part of the key to prevent traversal
    const sanitizedKeyParts = keyParts
      .map((part) => part.replace(/\.\./g, '').replace(/^\./g, '').trim())
      .filter((part) => part.length > 0)

    filename = `${prefix}/${sanitizedKeyParts.join('/')}`
  } else {
    // For regular filenames, remove any remaining path separators
    filename = filename.replace(/[/\\]/g, '')
  }

  // Additional validation: ensure filename is not empty after sanitization
  if (!filename || filename.trim().length === 0) {
    throw new Error('Invalid or empty filename after sanitization')
  }

  return filename
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename provided')
  }

  const sanitized = filename
    .replace(/\.\./g, '') // Remove .. sequences
    .replace(/[/\\]/g, '') // Remove path separators
    .replace(/^\./g, '') // Remove leading dots
    .trim()

  if (!sanitized || sanitized.length === 0) {
    throw new Error('Invalid or empty filename after sanitization')
  }

  if (
    sanitized.includes(':') ||
    sanitized.includes('|') ||
    sanitized.includes('?') ||
    sanitized.includes('*') ||
    sanitized.includes('\x00') || // Null bytes
    /[\x00-\x1F\x7F]/.test(sanitized) // Control characters
  ) {
    throw new Error('Filename contains invalid characters')
  }

  return sanitized
}

/**
 * Find a file in possible local storage locations with proper path validation
 */
export function findLocalFile(filename: string): string | null {
  try {
    const sanitizedFilename = sanitizeFilename(filename)

    const possiblePaths = [
      join(UPLOAD_DIR, sanitizedFilename),
      join(process.cwd(), 'uploads', sanitizedFilename),
    ]

    for (const path of possiblePaths) {
      const resolvedPath = resolve(path)
      const allowedDirs = [resolve(UPLOAD_DIR), resolve(process.cwd(), 'uploads')]

      const isWithinAllowedDir = allowedDirs.some(
        (allowedDir) => resolvedPath.startsWith(allowedDir + sep) || resolvedPath === allowedDir
      )

      if (!isWithinAllowedDir) {
        continue // Skip this path as it's outside allowed directories
      }

      if (existsSync(resolvedPath)) {
        return resolvedPath
      }
    }

    return null
  } catch (error) {
    logger.error('Error in findLocalFile:', error)
    return null
  }
}

const SAFE_INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
])

// File extensions that should always be served as attachment for security
const FORCE_ATTACHMENT_EXTENSIONS = new Set(['html', 'htm', 'svg', 'js', 'css', 'xml'])

/**
 * Determines safe content type and disposition for file serving
 */
function getSecureFileHeaders(filename: string, originalContentType: string) {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  // Force attachment for potentially dangerous file types
  if (FORCE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return {
      contentType: 'application/octet-stream', // Force download
      disposition: 'attachment',
    }
  }

  // Override content type for safety while preserving legitimate use cases
  let safeContentType = originalContentType

  // Handle potentially dangerous content types
  if (originalContentType === 'text/html' || originalContentType === 'image/svg+xml') {
    safeContentType = 'text/plain' // Prevent browser rendering
  }

  // Use inline only for verified safe content types
  const disposition = SAFE_INLINE_TYPES.has(safeContentType) ? 'inline' : 'attachment'

  return {
    contentType: safeContentType,
    disposition,
  }
}

/**
 * Create a file response with appropriate security headers
 */
export function createFileResponse(file: FileResponse): NextResponse {
  const { contentType, disposition } = getSecureFileHeaders(file.filename, file.contentType)

  return new NextResponse(file.buffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${file.filename}"`,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
    },
  })
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(error: Error, status = 500): NextResponse {
  // Map error types to appropriate status codes
  const statusCode =
    error instanceof FileNotFoundError ? 404 : error instanceof InvalidRequestError ? 400 : status

  return NextResponse.json(
    {
      error: error.name,
      message: error.message,
    },
    { status: statusCode }
  )
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse(data: ApiSuccessResponse): NextResponse {
  return NextResponse.json(data)
}

/**
 * Handle CORS preflight requests
 */
export function createOptionsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
