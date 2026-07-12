import { sleep } from '@sim/utils/helpers'
import { INSTAGRAM_GRAPH_BASE } from '@/lib/integrations/instagram'
import type { InstagramPublishResponse } from '@/tools/instagram/types'
import type { ToolConfig } from '@/tools/types'

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

export async function readGraphError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const json = JSON.parse(text) as { error?: { message?: string; code?: number } }
    if (json.error?.message) {
      return json.error.message
    }
  } catch {
    // keep raw text
  }
  return text || response.statusText
}

export async function resolveIgUserId(accessToken: string, igUserId?: string): Promise<string> {
  if (igUserId && igUserId.trim().length > 0) {
    return igUserId.trim()
  }

  const response = await fetch(graphUrl('/me', { fields: 'user_id' }), {
    headers: bearerHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve Instagram user id: ${await readGraphError(response)}`)
  }

  // Only /me's user_id is the Instagram professional account ID that publish
  // and messaging paths expect; /me's id is an app-scoped ID from a different
  // ID space, so never fall back to it.
  const data = (await response.json()) as { user_id?: string | number }
  if (data.user_id == null || data.user_id === '') {
    throw new Error('Instagram /me response did not include a user_id')
  }
  return String(data.user_id)
}

export type ContainerStatusCode = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export async function getContainerStatus(
  accessToken: string,
  containerId: string
): Promise<{ statusCode: ContainerStatusCode | null; status: string | null }> {
  const response = await fetch(graphUrl(`/${containerId}`, { fields: 'status_code,status' }), {
    headers: bearerHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(`Failed to get container status: ${await readGraphError(response)}`)
  }

  const data = (await response.json()) as { status_code?: string; status?: string }
  return {
    statusCode: (data.status_code as ContainerStatusCode | undefined) ?? null,
    status: data.status ?? null,
  }
}

// Meta recommends checking once per minute for no more than five minutes.
// Six attempts = an immediate check plus five minute-spaced checks, so the
// full five-minute window is covered before timing out.
const POLL_INTERVAL_MS = 60_000
const POLL_MAX_ATTEMPTS = 6

export async function waitForContainerReady(
  accessToken: string,
  containerId: string
): Promise<{ statusCode: ContainerStatusCode; status: string | null }> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const { statusCode, status } = await getContainerStatus(accessToken, containerId)

    if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') {
      return { statusCode, status }
    }
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(
        `Instagram media container ${containerId} failed with status ${statusCode}${status ? `: ${status}` : ''}`
      )
    }

    if (attempt < POLL_MAX_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MS)
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
  params: Record<string, unknown>
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
  })
}

export async function createMediaContainer(
  accessToken: string,
  igUserId: string,
  body: Record<string, unknown>
): Promise<string> {
  const response = await postGraphForm(accessToken, `/${igUserId}/media`, body)

  if (!response.ok) {
    throw new Error(`Failed to create media container: ${await readGraphError(response)}`)
  }

  const data = (await response.json()) as { id?: string | number }
  const id = idString(data.id)
  if (!id) {
    throw new Error('Create media container response missing id')
  }
  return id
}

export async function publishMediaContainer(
  accessToken: string,
  igUserId: string,
  creationId: string
): Promise<string> {
  const response = await postGraphForm(accessToken, `/${igUserId}/media_publish`, {
    creation_id: creationId,
  })

  if (!response.ok) {
    throw new Error(`Failed to publish media: ${await readGraphError(response)}`)
  }

  const data = (await response.json()) as { id?: string | number }
  const id = idString(data.id)
  if (!id) {
    throw new Error('Publish media response missing id')
  }
  return id
}

/** Shared output schema for the five publish tools (image, video, reel, story, carousel). */
export const PUBLISH_OUTPUTS: ToolConfig['outputs'] = {
  containerId: { type: 'string', description: 'Media container id', optional: true },
  mediaId: { type: 'string', description: 'Published media id', optional: true },
  statusCode: { type: 'string', description: 'Final container status', optional: true },
}

/**
 * Shared transformResponse for the publish tools, which all proxy through
 * internal API routes returning `{ success, output, error }`.
 */
export function createPublishTransform(fallbackError: string) {
  return async (response: Response): Promise<InstagramPublishResponse> => {
    const data = await response.json()
    const output = data.output || { containerId: null, mediaId: null, statusCode: null }
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
