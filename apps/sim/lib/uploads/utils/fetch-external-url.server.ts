import type { Buffer } from 'buffer'
import path from 'path'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { ensureFileNameExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

/**
 * Thrown when the URL fails SSRF/DNS validation. Callers should map this to a
 * user-facing 4xx-style response rather than a generic fetch failure.
 */
export class ExternalUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalUrlValidationError'
  }
}

export interface FetchExternalUrlOptions {
  url: string
  headers?: Record<string, string>
  signal?: AbortSignal
  maxDownloadBytes?: number
  timeoutMs?: number
}

export interface FetchExternalUrlResult {
  /**
   * Filename derived from the URL path. NOT a content identity — distinct URLs
   * frequently share the same path tail (e.g. every Slack clipboard paste is
   * `image.png`). Never use this as a cache key.
   */
  filename: string
  buffer: Buffer
  /** Content-Type from the response, or inferred from the filename extension. */
  mimeType: string
}

/**
 * Fetch an external URL into memory behind SSRF validation and download limits.
 *
 * URL fetches are NEVER deduplicated by filename. Two URLs whose paths end in
 * `image.png` are two different fetches with two different payloads; keying a
 * cache by path tail would silently return stale bytes.
 */
export async function fetchExternalUrl(
  options: FetchExternalUrlOptions
): Promise<FetchExternalUrlResult> {
  const {
    url,
    headers,
    signal,
    maxDownloadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const urlValidation = await validateUrlWithDNS(url, 'fileUrl', 'contentFetch')
  if (!urlValidation.isValid) {
    throw new ExternalUrlValidationError(urlValidation.error)
  }

  const pathFilename = new URL(url).pathname.split('/').pop() || 'download'
  const extension = path.extname(pathFilename).toLowerCase().substring(1)

  const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP, {
    profile: 'contentFetch',
    timeout: timeoutMs,
    maxResponseBytes: maxDownloadBytes,
    signal,
    ...(headers && Object.keys(headers).length > 0 && { headers }),
  })

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'external url error body',
      signal,
    }).catch(() => '')
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }

  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: maxDownloadBytes,
    label: 'external url download',
    signal,
  })

  const mimeType = response.headers.get('content-type') || getMimeTypeFromExtension(extension)
  const filename = ensureFileNameExtension(pathFilename, mimeType)

  return { filename, buffer, mimeType }
}
