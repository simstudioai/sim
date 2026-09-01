import { isRecordLike } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { PipedriveOperationError } from '@/lib/internal/pipedrive/errors'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'

export interface PipedriveFile {
  id?: number
  name?: string
  url?: string
  [key: string]: unknown
}

export interface PipedriveFilesPage {
  files: PipedriveFile[]
  hasMore: boolean
  nextStart: number | null
}

function isPipedriveHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'pipedrive.com' || hostname.endsWith('.pipedrive.com')
  } catch {
    return false
  }
}

export async function listPipedriveFiles(
  input: {
    accessToken: string
    authStyle?: 'x-api-token'
    limit?: string | null
    sort?: 'id' | 'update_time' | null
    start?: string | null
  },
  signal?: AbortSignal
): Promise<PipedriveFilesPage> {
  signal?.throwIfAborted()
  const url = new URL('https://api.pipedrive.com/v1/files')
  if (input.sort) url.searchParams.set('sort', input.sort)
  if (input.limit) url.searchParams.set('limit', input.limit)
  if (input.start) url.searchParams.set('start', input.start)
  const validation = await validateUrlWithDNS(url.toString(), 'apiUrl', 'configuredEndpoint')
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new PipedriveOperationError(validation.error || 'Invalid Pipedrive API URL', 400)
  }
  const response = await secureFetchWithPinnedIP(url.toString(), validation.resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: getPipedriveAuthHeaders(input),
    maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    signal,
  })
  const data = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Pipedrive files response',
    signal,
  })
  if (!isRecordLike(data) || data.success !== true) {
    throw new PipedriveOperationError(
      isRecordLike(data) && typeof data.error === 'string'
        ? data.error
        : 'Failed to fetch files from Pipedrive',
      400
    )
  }
  const files = Array.isArray(data.data)
    ? data.data.filter((file): file is PipedriveFile => isRecordLike(file))
    : []
  const additionalData = isRecordLike(data.additional_data) ? data.additional_data : null
  const pagination =
    additionalData && isRecordLike(additionalData.pagination) ? additionalData.pagination : null
  return {
    files,
    hasMore: pagination?.more_items_in_collection === true,
    nextStart: typeof pagination?.next_start === 'number' ? pagination.next_start : null,
  }
}

export async function downloadPipedriveFile(
  fileUrl: string,
  input: { accessToken: string; authStyle?: 'x-api-token' },
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(fileUrl, 'fileUrl', 'contentFetch')
  signal?.throwIfAborted()
  if (!validation.isValid) return null
  const authHeaders: Record<string, string> =
    input.authStyle === 'x-api-token'
      ? { 'x-api-token': input.accessToken }
      : { Authorization: `Bearer ${input.accessToken}` }
  const response = await secureFetchWithPinnedIP(fileUrl, validation.resolvedIP, {
    profile: 'contentFetch',
    method: 'GET',
    headers: isPipedriveHost(fileUrl) ? authHeaders : {},
    maxResponseBytes: maxBytes,
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  return {
    buffer: await readResponseToBufferWithLimit(response, {
      maxBytes,
      label: 'Pipedrive file download',
      signal,
    }),
    contentType: response.headers.get('content-type'),
  }
}
