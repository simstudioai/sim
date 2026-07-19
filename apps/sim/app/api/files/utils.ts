import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { ByteRange } from '@/lib/uploads/utils/byte-range'
import {
  byteRangeLength,
  contentRangeHeader,
  isMediaContentType,
  parseByteRange,
  unsatisfiableContentRangeHeader,
} from '@/lib/uploads/utils/byte-range'
import { getMimeTypeFromExtension, sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FilesUtils')

export interface ApiSuccessResponse {
  success: true
  [key: string]: any
}

interface ApiErrorResponse {
  error: string
  message?: string
}

export interface FileResponse {
  buffer: Buffer
  contentType: string
  filename: string
  cacheControl?: string
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
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
  pdf: 'application/pdf',
  googleDoc: 'application/vnd.google-apps.document',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  googleSheet: 'application/vnd.google-apps.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  zip: 'application/zip',
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
  'webp',
  'pdf',
]

/**
 * Content type for a stored file, by extension.
 *
 * {@link contentTypeMap} is consulted first because it carries entries the
 * extension map has no notion of (the Google Workspace pseudo-types), then the
 * canonical {@link getMimeTypeFromExtension} covers everything else — audio and
 * video included. Keeping only the local map meant `.mp4` resolved to
 * `application/octet-stream`, which silently disabled byte-range serving and
 * left media unseekable.
 */
export function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return contentTypeMap[extension] || getMimeTypeFromExtension(extension)
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

  if (filename.startsWith('s3/') || filename.startsWith('blob/') || filename.startsWith('gcs/')) {
    const parts = filename.split('/')
    const prefix = parts[0] // 's3', 'blob', or 'gcs'
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

export async function findLocalFile(filename: string): Promise<string | null> {
  try {
    const sanitizedFilename = sanitizeFileKey(filename)

    if (!sanitizedFilename || !sanitizedFilename.trim() || /^[/\\.\s]+$/.test(sanitizedFilename)) {
      return null
    }

    const { existsSync } = await import('fs')
    const path = await import('path')
    const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/core/setup.server')

    const resolvedPath = path.join(UPLOAD_DIR_SERVER, sanitizedFilename)

    if (
      !resolvedPath.startsWith(UPLOAD_DIR_SERVER + path.sep) ||
      resolvedPath === UPLOAD_DIR_SERVER
    ) {
      return null
    }

    if (existsSync(resolvedPath)) {
      return resolvedPath
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
  'image/svg+xml',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
])

const FORCE_ATTACHMENT_EXTENSIONS = new Set(['html', 'htm', 'js', 'css', 'xml'])

function getSecureFileHeaders(filename: string, originalContentType: string) {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  if (FORCE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return {
      contentType: 'application/octet-stream',
      disposition: 'attachment',
    }
  }

  let safeContentType = originalContentType

  if (originalContentType === 'text/html') {
    safeContentType = 'text/plain'
  }

  const disposition =
    SAFE_INLINE_TYPES.has(safeContentType) || isMediaContentType(safeContentType)
      ? 'inline'
      : 'attachment'

  return {
    contentType: safeContentType,
    disposition,
  }
}

export function encodeFilenameForHeader(storageKey: string): string {
  const filename = storageKey.split('/').pop() || storageKey

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

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(file.filename)}`,
    'Cache-Control': file.cacheControl || 'public, max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
  }

  if (contentType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
  }

  return new NextResponse(file.buffer as BodyInit, { status: 200, headers })
}

export interface ByteServeOptions {
  /**
   * Opens the bytes for a slice, or the whole object when no range is given.
   *
   * A function rather than a storage key so the same response builder serves
   * cloud objects (`downloadFileStream`) and local dev files (`createReadStream`)
   * — the two resolve a path differently, and forcing one shape on both is how
   * local storage ends up quietly without range support.
   */
  openStream: (range?: ByteRange) => Promise<Readable> | Readable
  /** Authoritative object size, from the storage layer — never a client-supplied number. */
  size: number
  contentType: string
  filename: string
  cacheControl?: string
  /** The request's raw `Range` header, if any. */
  rangeHeader: string | null
}

/**
 * Serves an object by streaming it, honouring a single HTTP `Range`.
 *
 * This is what makes a `<video>`/`<audio>` element usable: the browser fetches
 * the slice it needs and seeks with a short request, instead of the whole file
 * being downloaded (and, before this existed, held in the JS heap as a blob just
 * so the scrubber worked). Nothing is buffered server-side either.
 *
 * `Accept-Ranges: bytes` is always advertised, including on a full response —
 * browsers disable seeking without it.
 *
 * Offsets come from {@link parseByteRange}, which clamps every interval to
 * `size`, so a crafted header can neither read past the object nor reveal
 * anything about one the caller was not granted.
 */
export async function createByteRangeResponse(options: ByteServeOptions): Promise<NextResponse> {
  const { contentType, disposition } = getSecureFileHeaders(options.filename, options.contentType)
  const range = parseByteRange(options.rangeHeader, options.size)

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(options.filename)}`,
    'Cache-Control': options.cacheControl || 'public, max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  }

  if (range === 'unsatisfiable') {
    return new NextResponse(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': unsatisfiableContentRangeHeader(options.size) },
    })
  }

  const stream = await options.openStream(range ?? undefined)
  const body = Readable.toWeb(stream) as ReadableStream

  if (!range) {
    return new NextResponse(body, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(options.size) },
    })
  }

  return new NextResponse(body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': contentRangeHeader(range, options.size),
      'Content-Length': String(byteRangeLength(range)),
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
