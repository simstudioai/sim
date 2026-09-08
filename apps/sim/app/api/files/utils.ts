import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  isPayloadSizeLimitError,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { ensureFileNameExtension, sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

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
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  zip: 'application/zip',
  googleFolder: 'application/vnd.google-apps.folder',
}

export function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return contentTypeMap[extension] || 'application/octet-stream'
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
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
])

const FORCE_ATTACHMENT_EXTENSIONS = new Set(['html', 'htm', 'js', 'css', 'xml'])

export function getSecureFileHeaders(filename: string, originalContentType: string) {
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

  const disposition = SAFE_INLINE_TYPES.has(safeContentType) ? 'inline' : 'attachment'

  return {
    contentType: safeContentType,
    disposition,
  }
}

/**
 * Percent-encode a filename as an RFC 8187 `ext-value`.
 *
 * `encodeURIComponent` alone is not enough: it leaves `'`, `(`, `)` and `*` raw, and
 * none of those are `attr-char`. The apostrophe is the specific hazard — it is the
 * delimiter in `UTF-8''name`, so a filename like `it's.pdf` would emit a third `'`
 * and desync the parser.
 */
function encodeExtValue(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * Build the `filename` parameters for a Content-Disposition header.
 *
 * The name is attacker-controlled (it is the user's `originalName`), so it can never
 * be interpolated raw: a `"` closes the quoted-string early and everything after it
 * is parsed as further parameters. An injected `filename*` is the payload that
 * matters, because RFC 6266 tells clients to prefer `filename*` over `filename` —
 * so the attacker's value wins and the download lands under a name the product UI
 * never showed. Both parameters are therefore always emitted from sanitized input:
 * the quoted form keeps only printable ASCII minus `"` and `\`, and the `filename*`
 * form is fully percent-encoded.
 *
 * `;` is neutralized too, even though a quoted string may legally contain one: the
 * quoted parameter exists as the fallback for clients that do not implement
 * `filename*`, and those are the same clients liable to split parameters on a bare
 * `;` without honouring the quoting. The exact name still survives in `filename*`.
 */
export function encodeFilenameForHeader(storageKey: string): string {
  const filename = storageKey.split('/').pop() || storageKey
  const asciiSafe = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\;]/g, '_')
  // Unchanged input proves the name is printable ASCII with no `"` or `\`, so the
  // quoted form alone is both safe and sufficient — `filename*` buys nothing here.
  if (asciiSafe === filename) {
    return `filename="${filename}"`
  }
  return `filename="${asciiSafe}"; filename*=UTF-8''${encodeExtValue(filename)}`
}

/**
 * Derives the served filename from the CALLER's content type (`getSecureFileHeaders`
 * downgrades `text/html`) before the header decision, so a derived `.html` name gets the
 * same forced-attachment treatment a stored `.html` file gets.
 */
export function createFileResponse(file: FileResponse): NextResponse {
  const servedFilename = ensureFileNameExtension(file.filename, file.contentType)

  const { contentType, disposition } = getSecureFileHeaders(servedFilename, file.contentType)

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(servedFilename)}`,
    // Default to PRIVATE: this response is served only after access verification, so it must never be
    // stored by a shared cache/CDN and re-served cross-user. Genuinely public assets (avatars, OG images,
    // workspace logos) pass an explicit `cacheControl` (see PUBLIC_ASSET_CACHE_CONTROL in the serve route).
    'Cache-Control': file.cacheControl || 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
  }

  if (contentType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
  }

  return new NextResponse(file.buffer as BodyInit, { status: 200, headers })
}

export function createErrorResponse(error: Error, status = 500): NextResponse {
  const statusCode =
    error instanceof FileNotFoundError
      ? 404
      : error instanceof InvalidRequestError
        ? 400
        : // A file too large to hold resident is the caller asking for something this
          // route will not do, not a server fault — 413 keeps it out of the 5xx alarms
          // and tells the client retrying is pointless.
          isPayloadSizeLimitError(error)
          ? 413
          : status

  return NextResponse.json(
    {
      error: error.name,
      message: error.message,
    },
    { status: statusCode }
  )
}

/**
 * Reads a local upload into memory under a hard byte ceiling.
 *
 * The self-hosted mirror of the `maxBytes` every cloud provider download takes:
 * a bare `readFile` inherits the 5 GB admission ceiling workspace files are stored
 * under and allocates all of it inside the shared app process.
 *
 * The limit is enforced on the bytes as they arrive, through the same bounded-stream
 * reader the S3/Blob/GCS downloads use, rather than by checking `stat` and then
 * reading. A declared size only describes the file at the moment it was measured, so
 * a stat-then-read pair admits whatever the file becomes in between — the cloud
 * providers check `ContentLength` too, but never trust it as the only bound.
 */
export async function readLocalFileWithinLimit(
  filePath: string,
  maxBytes: number,
  label: string
): Promise<Buffer> {
  const { createReadStream } = await import('fs')
  const stream = createReadStream(filePath)
  try {
    return await readNodeStreamToBufferWithLimit(stream, { maxBytes, label })
  } finally {
    stream.destroy()
  }
}

export function createSuccessResponse(data: ApiSuccessResponse): NextResponse {
  return NextResponse.json(data)
}
