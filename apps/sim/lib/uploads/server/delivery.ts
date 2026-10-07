import { createHash } from 'node:crypto'
import { ensureFileNameExtension } from '@/lib/uploads/utils/file-utils'

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

function getSecureFileHeaders(filename: string, originalContentType: string) {
  const extension = filename.split('.').pop()?.toLowerCase() || ''

  if (FORCE_ATTACHMENT_EXTENSIONS.has(extension)) {
    return {
      contentType: 'application/octet-stream',
      disposition: 'attachment',
    }
  }

  const mediaType = originalContentType.split(';', 1)[0].trim().toLowerCase()
  const safeContentType = mediaType === 'text/html' ? 'text/plain' : originalContentType
  const disposition = SAFE_INLINE_TYPES.has(mediaType === 'text/html' ? 'text/plain' : mediaType)
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

/** Explicit delivery policies preserve each surface's existing browser cache behavior. */
export const FILE_CACHE_CONTROL = {
  noStore: 'private, no-store',
  revalidate: 'private, no-cache, must-revalidate',
  private: 'private, no-cache',
  immutable: 'private, max-age=31536000, immutable',
  publicAsset: 'public, max-age=31536000',
} as const

/** Constructs identical security and filename headers for buffered and streamed representations. */
export function fileDeliveryHeaders(input: {
  filename: string
  contentType: string
  cacheControl: string
  contentLength?: number
  attachment?: boolean
}): Headers {
  const filename = ensureFileNameExtension(input.filename, input.contentType)
  const secure = getSecureFileHeaders(filename, input.contentType)
  const headers = new Headers({
    'Content-Type': secure.contentType,
    'Content-Disposition': `${input.attachment ? 'attachment' : secure.disposition}; ${encodeFilenameForHeader(filename)}`,
    'Cache-Control': input.cacheControl,
    'X-Content-Type-Options': 'nosniff',
  })
  if (input.contentLength !== undefined) headers.set('Content-Length', String(input.contentLength))
  if (secure.contentType.split(';', 1)[0].trim().toLowerCase() === 'image/svg+xml')
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
    )
  return headers
}

/** Hash only already-buffered representations; streamed downloads never need materializing. */
export function bufferedRepresentationEtag(buffer: Buffer): string {
  return `"${createHash('sha256').update(buffer).digest('base64url')}"`
}

/** Binary presenters share header assembly without coupling storage mechanics to a route framework. */
export function presentFileDelivery(input: {
  body: Buffer | ReadableStream<Uint8Array>
  filename: string
  contentType: string
  contentLength: number
  cacheControl: string
  attachment?: boolean
}) {
  const headers = fileDeliveryHeaders(input)
  return {
    body: Buffer.isBuffer(input.body)
      ? new Uint8Array(
          input.body.buffer as ArrayBuffer,
          input.body.byteOffset,
          input.body.byteLength
        )
      : input.body,
    contentType: headers.get('Content-Type') ?? 'application/octet-stream',
    contentLength: input.contentLength,
    headers,
  }
}

/** Immutable workspace caching requires a fixed storage object and no live referenced inputs. */
export function workspaceFileCacheControl(
  contentAddressed: boolean,
  dependsOnReferencedFiles = false
): string {
  return contentAddressed && !dependsOnReferencedFiles
    ? FILE_CACHE_CONTROL.immutable
    : FILE_CACHE_CONTROL.revalidate
}
