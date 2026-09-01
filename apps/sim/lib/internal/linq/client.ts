import { isRecordLike } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { LinqOperationError } from '@/lib/internal/linq/errors'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'

export interface RegisteredLinqAttachment {
  attachmentId: string
  downloadUrl: string | null
  httpMethod: string
  requiredHeaders: Record<string, string>
  uploadUrl: string
}

function stringHeaders(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!isRecordLike(value)) return fallback
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
  return Object.fromEntries(entries)
}

export async function registerLinqAttachment(
  input: {
    apiKey: string
    contentType: string
    filename: string
    sizeBytes: number
  },
  signal?: AbortSignal
): Promise<RegisteredLinqAttachment> {
  signal?.throwIfAborted()
  const response = await fetch(`${LINQ_API_BASE}/attachments`, {
    method: 'POST',
    headers: linqHeaders(input.apiKey),
    body: JSON.stringify({
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
    }),
    signal,
  })
  const data = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Linq attachment registration response',
    signal,
  }).catch(() => null)
  if (!response.ok) {
    throw new LinqOperationError(
      extractLinqError(data, 'Failed to register attachment'),
      response.status
    )
  }
  if (!isRecordLike(data)) {
    throw new LinqOperationError('Linq did not return an upload URL or attachment ID', 502)
  }
  const uploadUrl = typeof data.upload_url === 'string' ? data.upload_url : ''
  const attachmentId = typeof data.attachment_id === 'string' ? data.attachment_id : ''
  if (!uploadUrl || !attachmentId) {
    throw new LinqOperationError('Linq did not return an upload URL or attachment ID', 502)
  }
  const fallbackHeaders = {
    'Content-Type': input.contentType,
    'Content-Length': String(input.sizeBytes),
  }
  return {
    attachmentId,
    downloadUrl: typeof data.download_url === 'string' ? data.download_url : null,
    httpMethod: typeof data.http_method === 'string' ? data.http_method : 'PUT',
    requiredHeaders: stringHeaders(data.required_headers, fallbackHeaders),
    uploadUrl,
  }
}

export async function uploadLinqAttachmentBytes(
  registration: RegisteredLinqAttachment,
  buffer: Buffer,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(registration.uploadUrl, 'uploadUrl', 'contentFetch')
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new LinqOperationError(validation.error || 'Invalid Linq upload URL', 400)
  }
  const response = await secureFetchWithPinnedIP(registration.uploadUrl, validation.resolvedIP, {
    profile: 'contentFetch',
    method: registration.httpMethod,
    headers: registration.requiredHeaders,
    body: new Uint8Array(buffer),
    maxResponseBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    signal,
  })
  if (response.ok) return
  await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Linq presigned upload error response',
    signal,
  }).catch(() => '')
  throw new LinqOperationError(`Failed to upload file bytes to Linq (${response.status})`, 502)
}
