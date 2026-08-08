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
import { resolveEffectiveMimeType, sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

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

/**
 * The pseudo-extensions no real filename ends in, so no MIME table knows them.
 *
 * Everything else resolves through {@link resolveEffectiveMimeType}. This map
 * used to carry 41 entries, 38 of which duplicated `EXTENSION_TO_MIME`
 * byte-for-byte — and that duplication was the bug: a container present in one
 * table and missing from the other (`.mkv`, `.flac`, `.aac`, `.opus`, `.avi`)
 * resolved to `application/octet-stream`, which silently disabled byte-range
 * serving and left it unseekable. Two tables cannot be kept in agreement by
 * hand, so there is now one.
 */
/**
 * Cache policy for bytes a viewer must be re-authorized for on every request:
 * private, and revalidated rather than served from the browser's back-forward
 * cache after access is revoked.
 *
 * One export because it is the caching policy for every authenticated and every
 * shared byte, and it was previously written out in four places across three
 * files — kept in agreement only by eye.
 */
export const REVALIDATE_CACHE_CONTROL = 'private, no-cache, must-revalidate'

const GOOGLE_PSEUDO_MIME: Record<string, string> = {
  googleDoc: 'application/vnd.google-apps.document',
  googleSheet: 'application/vnd.google-apps.spreadsheet',
  googleFolder: 'application/vnd.google-apps.folder',
}

/**
 * Content type for a stored file, by extension.
 *
 * {@link GOOGLE_PSEUDO_MIME} is consulted first for the three Workspace
 * pseudo-extensions no MIME table knows; everything else goes to
 * {@link resolveEffectiveMimeType}.
 *
 * That resolver rather than the raw extension table because what a response
 * declares IS presentation, and it is the only one that knows a dual container.
 * `.webm` holds either audio or video; the extension table answers `audio/webm`
 * so the speech-to-text route does not send it down an ffmpeg path it does not
 * need, while the viewer routes it to a `<video>`. Declaring `audio/webm` on the
 * wire would leave one user-facing surface disagreeing with the rest.
 */
export function getContentType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() || ''
  return GOOGLE_PSEUDO_MIME[extension] || resolveEffectiveMimeType(undefined, filename)
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

/**
 * Served as an opaque download regardless of what their bytes look like.
 *
 * `html`/`htm`/`js`/`css`/`xml` because rendering them inline is an execution
 * vector. The config-file group is here for a different reason: resolving an
 * extension through the canonical MIME table (rather than defaulting everything
 * unknown to `application/octet-stream`) is what makes byte-range serving work,
 * but it also promoted these five from "unknown bytes" to `text/plain`, which is
 * on the inline allowlist. A shared `.env` that used to download would otherwise
 * start rendering in the tab. Nothing about the media work needs that, so the
 * previous behaviour is kept explicitly.
 */
const FORCE_ATTACHMENT_EXTENSIONS = new Set([
  'html',
  'htm',
  'js',
  'css',
  'xml',
  'cfg',
  'conf',
  'env',
  'ini',
  'log',
])

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

export function createFileResponse(file: FileResponse): NextResponse {
  const { contentType, disposition } = getSecureFileHeaders(file.filename, file.contentType)

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; ${encodeFilenameForHeader(file.filename)}`,
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
    // Same default as createFileResponse, and for the same reason: a byte-served object
    // reaches here only after access verification, so an unspecified policy must never
    // let a shared cache/CDN store it and re-serve it cross-user. Public assets pass an
    // explicit `cacheControl`.
    'Cache-Control': options.cacheControl || 'private, no-cache',
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
