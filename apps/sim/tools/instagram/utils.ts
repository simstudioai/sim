import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { INSTAGRAM_GRAPH_BASE } from '@/lib/integrations/instagram/constants'
import type { InstagramPublishResponse } from '@/tools/instagram/types'

export const INSTAGRAM_RESPONSE_MAX_BYTES = 2 * 1024 * 1024

export interface InstagramGraphPaging {
  cursors?: { after?: string }
  next?: string
}

export interface InstagramGraphPage<T> {
  data?: T[]
  paging?: InstagramGraphPaging
}

export async function readGraphJson<T>(
  response: Response,
  label: string,
  signal?: AbortSignal
): Promise<T> {
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: INSTAGRAM_RESPONSE_MAX_BYTES,
    label,
    signal,
  })
}

export function bearerHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
  }
}

/** For the messaging endpoints, which take a JSON body (publish endpoints are form-encoded). */
export function jsonBearerHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

export function graphUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(
    path.startsWith('http')
      ? path
      : `${INSTAGRAM_GRAPH_BASE}${path.startsWith('/') ? path : `/${path}`}`
  )
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value)
      }
    }
  }
  return url.toString()
}

/**
 * Graph may serialize IDs as strings or numbers. Normalize to a string (or
 * null) so downstream tools can safely call .trim() on wired ID outputs.
 */
export function idString(value: unknown): string | null {
  if (value == null || value === '') return null
  return String(value)
}

interface InstagramGraphErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

export async function readGraphError(response: Response): Promise<string> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Instagram Graph error response',
  }).catch(() => '')

  try {
    const graphError = (JSON.parse(text) as InstagramGraphErrorBody).error
    if (graphError?.message) {
      const diagnostics = [
        graphError.type ? `type ${graphError.type}` : null,
        graphError.code !== undefined ? `code ${graphError.code}` : null,
        graphError.error_subcode !== undefined ? `subcode ${graphError.error_subcode}` : null,
        graphError.fbtrace_id ? `trace ${graphError.fbtrace_id}` : null,
      ].filter((value): value is string => value !== null)

      return diagnostics.length > 0
        ? `${graphError.message} (${diagnostics.join(', ')})`
        : graphError.message
    }
  } catch {
    return text || response.statusText
  }

  return text || response.statusText
}

export async function resolveIgUserId(
  accessToken: string,
  igUserId?: string,
  signal?: AbortSignal
): Promise<string> {
  if (igUserId && igUserId.trim().length > 0) {
    return igUserId.trim()
  }

  const response = await fetch(graphUrl('/me', { fields: 'user_id' }), {
    headers: bearerHeaders(accessToken),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve Instagram user id: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ user_id?: string | number }>(
    response,
    'Instagram user response',
    signal
  )
  if (data.user_id == null || data.user_id === '') {
    throw new Error('Instagram /me response did not include a user_id')
  }
  return String(data.user_id)
}

export type ContainerStatusCode = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export async function getContainerStatus(
  accessToken: string,
  containerId: string,
  signal?: AbortSignal
): Promise<{ statusCode: ContainerStatusCode | null; status: string | null }> {
  const response = await fetch(graphUrl(`/${containerId}`, { fields: 'status_code,status' }), {
    headers: bearerHeaders(accessToken),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Failed to get container status: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ status_code?: string; status?: string }>(
    response,
    'Instagram container status response',
    signal
  )
  return {
    statusCode: (data.status_code as ContainerStatusCode | undefined) ?? null,
    status: data.status ?? null,
  }
}

const POLL_INTERVAL_MS = 60_000
const POLL_MAX_ATTEMPTS = 6

async function waitForNextPoll(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(POLL_INTERVAL_MS)
    return
  }

  if (signal.aborted) {
    throw toError(signal.reason ?? new Error('Instagram publishing was cancelled'))
  }

  let abortHandler: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () =>
      reject(toError(signal.reason ?? new Error('Instagram publishing was cancelled')))
    signal.addEventListener('abort', abortHandler, { once: true })
  })

  try {
    await Promise.race([sleep(POLL_INTERVAL_MS), aborted])
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler)
  }
}

export async function waitForContainerReady(
  accessToken: string,
  containerId: string,
  signal?: AbortSignal
): Promise<{ statusCode: ContainerStatusCode; status: string | null }> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const { statusCode, status } = await getContainerStatus(accessToken, containerId, signal)

    if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') {
      return { statusCode, status }
    }
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(
        `Instagram media container ${containerId} failed with status ${statusCode}${status ? `: ${status}` : ''}`
      )
    }

    if (attempt < POLL_MAX_ATTEMPTS - 1) {
      await waitForNextPoll(signal)
    }
  }

  throw new Error(`Timed out waiting for Instagram container ${containerId} to finish processing`)
}

/**
 * Graph content publishing endpoints document query/form parameters, not JSON
 * bodies (JSON is only documented for the messaging endpoints), so publish
 * POSTs are sent form-encoded.
 */
async function postGraphForm(
  accessToken: string,
  path: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      form.set(key, String(value))
    }
  }

  return fetch(graphUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal,
  })
}

export async function createMediaContainer(
  accessToken: string,
  igUserId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const response = await postGraphForm(accessToken, `/${igUserId}/media`, body, signal)

  if (!response.ok) {
    throw new Error(`Failed to create media container: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ id?: string | number }>(
    response,
    'Instagram create container response',
    signal
  )
  const id = idString(data.id)
  if (!id) {
    throw new Error('Create media container response missing id')
  }
  return id
}

export async function publishMediaContainer(
  accessToken: string,
  igUserId: string,
  creationId: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await postGraphForm(
    accessToken,
    `/${igUserId}/media_publish`,
    {
      creation_id: creationId,
    },
    signal
  )

  if (!response.ok) {
    throw new Error(`Failed to publish media: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ id?: string | number }>(
    response,
    'Instagram publish media response',
    signal
  )
  const id = idString(data.id)
  if (!id) {
    throw new Error('Publish media response missing id')
  }
  return id
}

/**
 * Shared transformResponse for the publish tools, which all proxy through
 * internal API routes returning `{ success, output, error }`.
 */
export function createPublishTransform(fallbackError: string) {
  return async (response: Response): Promise<InstagramPublishResponse> => {
    const text = await readResponseTextWithLimit(response, {
      maxBytes: INSTAGRAM_RESPONSE_MAX_BYTES,
      label: 'Instagram publish response',
    }).catch(() => '')
    const fallbackOutput = { containerId: null, mediaId: null, statusCode: null }

    let data: {
      success?: boolean
      output?: InstagramPublishResponse['output']
      error?: string
    } = {}

    if (text) {
      try {
        data = JSON.parse(text) as typeof data
      } catch {
        if (!response.ok) {
          return {
            success: false,
            output: fallbackOutput,
            error: `${fallbackError}: ${text}`,
          }
        }
        return {
          success: false,
          output: fallbackOutput,
          error: `${fallbackError}: invalid JSON response`,
        }
      }
    }

    const output = data.output ?? fallbackOutput
    if (!response.ok || data.success === false) {
      return { success: false, output, error: data.error || fallbackError }
    }
    return { success: true, output }
  }
}

export function parseCommaSeparated(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Clamp Graph pagination `limit` to a safe range (default 25, max 100). */
export function clampGraphLimit(limit: number | undefined, fallback = 25): number {
  if (limit == null || Number.isNaN(Number(limit))) return fallback
  return Math.min(100, Math.max(1, Math.floor(Number(limit))))
}
