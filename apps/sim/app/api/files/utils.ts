import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import {
  isPayloadSizeLimitError,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  bufferedRepresentationEtag,
  FILE_CACHE_CONTROL,
  fileDeliveryHeaders,
} from '@/lib/uploads/server/delivery'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FilesUtils')

export interface ApiSuccessResponse {
  success: true
  [key: string]: any
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

const contentTypeMap: Record<string, string> = {
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

/**
 * Derives the served filename from the CALLER's content type (`getSecureFileHeaders`
 * downgrades `text/html`) before the header decision, so a derived `.html` name gets the
 * same forced-attachment treatment a stored `.html` file gets.
 */
export function createFileResponse(file: FileResponse): NextResponse {
  return new NextResponse(file.buffer as BodyInit, {
    status: 200,
    headers: fileDeliveryHeaders({
      ...file,
      cacheControl: file.cacheControl || FILE_CACHE_CONTROL.private,
      contentLength: file.buffer.length,
    }),
  })
}

/**
 * Whether an `If-None-Match` header claims the client already holds `etag`.
 *
 * Compared weakly, per RFC 9110: a cache that stored the response under a weak validator sends
 * `W/"…"` back, and that still identifies the same bytes for a GET.
 */
function ifNoneMatchHolds(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '').trim() === etag)
}

/**
 * A file response carrying a strong validator, answering 304 when the client already holds
 * exactly these bytes.
 *
 * For responses the browser is told to revalidate, the alternative is re-sending the whole body on
 * every check — and a document resolved against other files is re-resolved per request precisely
 * BECAUSE its bytes may have changed, so it cannot be given a cache lifetime instead. The
 * validator is the digest of the bytes about to be sent, which makes it exact by construction: it
 * cannot claim freshness for a body that differs, however the body was produced.
 *
 * This is deliberately NOT folded into {@link createFileResponse}. Digesting costs a pass over the
 * buffer — up to the full transfer ceiling — which is worth it only where a 304 can actually be
 * returned. A response already served as immutable is never revalidated, so it would pay the pass
 * and never collect.
 */
export function createConditionalFileResponse(
  file: FileResponse,
  ifNoneMatch: string | null
): NextResponse {
  const etag = bufferedRepresentationEtag(file.buffer)

  if (ifNoneMatchHolds(ifNoneMatch, etag)) {
    const headers = fileDeliveryHeaders({
      ...file,
      cacheControl: file.cacheControl || FILE_CACHE_CONTROL.private,
    })
    headers.set('ETag', etag)
    return new NextResponse(null, { status: 304, headers })
  }

  const response = createFileResponse(file)
  response.headers.set('ETag', etag)
  return response
}

export function createFileErrorResponse(error: Error, status = 500): NextResponse {
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
    {
      status: statusCode,
      headers: { 'Cache-Control': FILE_CACHE_CONTROL.noStore, 'X-Content-Type-Options': 'nosniff' },
    }
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
