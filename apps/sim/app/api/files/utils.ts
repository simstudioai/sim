import { existsSync } from 'fs'
import { join, resolve, sep } from 'path'
import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { UPLOAD_DIR } from '@/lib/uploads/setup'

const logger = createLogger('FilesUtils')

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

export function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return contentTypeMap[extension] || 'application/octet-stream'
}

export function isS3Path(path: string): boolean {
  return path.includes('/api/files/serve/s3/')
}

export function isBlobPath(path: string): boolean {
  return path.includes('/api/files/serve/blob/')
}

export function isCloudPath(path: string): boolean {
  return isS3Path(path) || isBlobPath(path)
}

export function extractStorageKey(path: string, storageType: 's3' | 'blob'): string {
  const prefix = `/api/files/serve/${storageType}/`
  if (path.includes(prefix)) {
    return decodeURIComponent(path.split(prefix)[1])
  }
  return path
}

export function extractS3Key(path: string): string {
  return extractStorageKey(path, 's3')
}

export function extractBlobKey(path: string): string {
  return extractStorageKey(path, 'blob')
}

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

  if (filename.startsWith('s3/') || filename.startsWith('blob/')) {
    const parts = filename.split('/')
    const prefix = parts[0] // 's3' or 'blob'
    const keyParts = parts.slice(1)

    const sanitizedKeyParts = keyParts
      .map((part) => part.replace(/\.\./g, '').replace(/^\./g, '').trim())
      .filter((part) => part.length > 0)

    filename = `${prefix}/${sanitizedKeyParts.join('/')}`
  } else {
    filename = filename.replace(/[/\\]/g, '')
  }

  if (!filename || filename.trim().length === 0) {
    throw new Error('Invalid or empty filename after sanitization')
  }

  return filename
}

function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename provided')
  }

  const sanitized = filename.replace(/\.\./g, '').replace(/[/\\]/g, '').replace(/^\./g, '').trim()

  if (!sanitized || sanitized.length === 0) {
    throw new Error('Invalid or empty filename after sanitization')
  }

  if (
    sanitized.includes(':') ||
    sanitized.includes('|') ||
    sanitized.includes('?') ||
    sanitized.includes('*') ||
    sanitized.includes('\x00') ||
    /[\x00-\x1F\x7F]/.test(sanitized)
  ) {
    throw new Error('Filename contains invalid characters')
  }

  return sanitized
}

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
        continue
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

const FORCE_ATTACHMENT_EXTENSIONS = new Set(['html', 'htm', 'svg', 'js', 'css', 'xml'])

function getSecureFileHeaders(filename: string, originalContentType: string) {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  if (FORCE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return {
      contentType: 'application/octet-stream',
      disposition: 'attachment',
    }
  }

  let safeContentType = originalContentType

  if (originalContentType === 'text/html' || originalContentType === 'image/svg+xml') {
    safeContentType = 'text/plain'
  }

  const disposition = SAFE_INLINE_TYPES.has(safeContentType) ? 'inline' : 'attachment'

  return {
    contentType: safeContentType,
    disposition,
  }
}

function encodeFilenameForHeader(filename: string): string {
  const hasNonAscii = /[^\x00-\x7F]/.test(filename)

  if (!hasNonAscii) {
    return `filename="${filename}"`
  }

  const encodedFilename = encodeURIComponent(filename)
  const asciiSafe = filename.replace(/[^\x00-\x7F]/g, '_')
  return `filename="${asciiSafe}"; filename*=UTF-8''${encodedFilename}`
}

export function createFileResponse(file: FileResponse): NextResponse {
  const { contentType, disposition } = getSecureFileHeaders(file.filename, file.contentType)

  return new NextResponse(file.buffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(file.filename)}`,
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox;",
    },
  })
}

export function createErrorResponse(error: Error, status = 500): NextResponse {
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

export function createSuccessResponse(data: ApiSuccessResponse): NextResponse {
  return NextResponse.json(data)
}

export function createOptionsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
