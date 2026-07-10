import { sleep } from '@sim/utils/helpers'
import { INSTAGRAM_GRAPH_BASE } from '@/lib/integrations/instagram'

export function bearerHeaders(accessToken: string): Record<string, string> {
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

export async function createMediaContainer(
  accessToken: string,
  igUserId: string,
  body: Record<string, unknown>
): Promise<string> {
  const response = await fetch(graphUrl(`/${igUserId}/media`), {
    method: 'POST',
    headers: bearerHeaders(accessToken),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Failed to create media container: ${await readGraphError(response)}`)
  }

  const data = (await response.json()) as { id?: string }
  if (!data.id) {
    throw new Error('Create media container response missing id')
  }
  return data.id
}

export async function publishMediaContainer(
  accessToken: string,
  igUserId: string,
  creationId: string
): Promise<string> {
  const response = await fetch(graphUrl(`/${igUserId}/media_publish`), {
    method: 'POST',
    headers: bearerHeaders(accessToken),
    body: JSON.stringify({ creation_id: creationId }),
  })

  if (!response.ok) {
    throw new Error(`Failed to publish media: ${await readGraphError(response)}`)
  }

  const data = (await response.json()) as { id?: string }
  if (!data.id) {
    throw new Error('Publish media response missing id')
  }
  return data.id
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
