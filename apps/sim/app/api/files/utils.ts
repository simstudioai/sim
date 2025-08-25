import { existsSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'
import { UPLOAD_DIR } from '@/lib/uploads/setup'

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
  svg: 'image/svg+xml',
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

  // Security: Remove path traversal sequences and validate
  // This prevents directory traversal attacks while maintaining backward compatibility
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
 * Find a file in possible local storage locations
 */
export function findLocalFile(filename: string): string | null {
  const possiblePaths = [join(UPLOAD_DIR, filename), join(process.cwd(), 'uploads', filename)]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}

/**
 * Create a file response with appropriate headers
 */
export function createFileResponse(file: FileResponse): NextResponse {
  return new NextResponse(file.buffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
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
