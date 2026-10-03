import { getErrorMessage } from '@sim/utils/errors'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { INSTAGRAM_GRAPH_BASE } from '@/tools/instagram/constants'
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

/**
 * Shared transformResponse for the publish tools, which all proxy through
 * internal API routes returning `{ success, output, error }`.
 */
export function createPublishTransform(fallbackError: string) {
  return async (response: Response): Promise<InstagramPublishResponse> => {
    const fallbackOutput = { containerId: null, mediaId: null, statusCode: null }
    let data: unknown

    try {
      data = await readResponseJsonWithLimit<unknown>(response, {
        maxBytes: INSTAGRAM_RESPONSE_MAX_BYTES,
        label: 'Instagram publish response',
      })
    } catch (error) {
      return {
        success: false,
        output: fallbackOutput,
        error: getErrorMessage(error, fallbackError),
      }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        success: false,
        output: fallbackOutput,
        error: `${fallbackError}: invalid response`,
      }
    }

    const envelope = data as Record<string, unknown>
    const rawOutput = envelope.output
    const output = isInstagramPublishOutput(rawOutput) ? rawOutput : fallbackOutput
    const error =
      typeof envelope.error === 'string' && envelope.error.trim()
        ? envelope.error.trim()
        : fallbackError

    if (!response.ok || envelope.success === false) {
      return { success: false, output, error }
    }

    if (envelope.success !== true || !isCompleteInstagramPublishOutput(rawOutput)) {
      return {
        success: false,
        output: fallbackOutput,
        error: `${fallbackError}: invalid success response`,
      }
    }

    return { success: true, output }
  }
}

function isInstagramPublishOutput(value: unknown): value is InstagramPublishResponse['output'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const output = value as Record<string, unknown>
  return [output.containerId, output.mediaId, output.statusCode].every(
    (field) => field === null || typeof field === 'string'
  )
}

function isCompleteInstagramPublishOutput(
  value: unknown
): value is InstagramPublishResponse['output'] {
  if (!isInstagramPublishOutput(value)) return false

  return [value.containerId, value.mediaId, value.statusCode].every(
    (field) => typeof field === 'string' && field.trim().length > 0
  )
}

export function parseCommaSeparated(value: unknown): string[] {
  if (typeof value !== 'string') {
    throw new Error('Instagram insight metrics must be a non-empty comma-separated string')
  }

  const items = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (items.length === 0) {
    throw new Error('Instagram insight metrics must be a non-empty comma-separated string')
  }

  return items
}

/** Clamp Graph pagination `limit` to a safe range (default 25, max 100). */
export function clampGraphLimit(limit: number | undefined, fallback = 25): number {
  if (limit == null || Number.isNaN(Number(limit))) return fallback
  return Math.min(100, Math.max(1, Math.floor(Number(limit))))
}
