import type { DowndetectorIncident } from '@/tools/downdetector/types'

interface RawIncident {
  id?: number
  created_at?: string
  resolved_at?: string
  is_active?: boolean
  peak_attribution?: number
  peak_user_impact?: number
  total?: number
  indicators?: number
  other?: number
  updated_at?: string
}

/** Map a raw Downdetector incident object to the camelCased output shape. */
export function mapDowndetectorIncident(incident: RawIncident): DowndetectorIncident {
  return {
    id: incident.id ?? null,
    createdAt: incident.created_at ?? null,
    resolvedAt: incident.resolved_at ?? null,
    isActive: incident.is_active ?? null,
    peakAttribution: incident.peak_attribution ?? null,
    peakUserImpact: incident.peak_user_impact ?? null,
    total: incident.total ?? null,
    indicators: incident.indicators ?? null,
    other: incident.other ?? null,
    updatedAt: incident.updated_at ?? null,
  }
}

/** Output schema for an incident object, shared by the incident tools. */
export const downdetectorIncidentItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'number', description: 'Incident id' },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp when the incident was created' },
    resolvedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the incident was resolved (null if active)',
    },
    isActive: { type: 'boolean', description: 'Whether the incident is currently active' },
    peakAttribution: {
      type: 'number',
      description: 'Peak attribution enum (0 N/A, 1 undetermined, 2 external, 3 internal)',
    },
    peakUserImpact: {
      type: 'number',
      description: 'Peak user impact enum (0 low, 1 medium, 2 high, 3 very high)',
    },
    total: { type: 'number', description: 'Total reports during the incident' },
    indicators: { type: 'number', description: 'Number of indicator reports during the incident' },
    other: { type: 'number', description: 'Number of other reports during the incident' },
    updatedAt: { type: 'string', description: 'ISO 8601 timestamp when the incident was updated' },
  },
} as const

/**
 * Read the next-page cursor from a Downdetector response. Paged endpoints return
 * the value to send back as `?page=...` in the `X-Page-Next` header; an absent
 * header means the current page is the last one.
 */
export function nextPageFromResponse(response: Response): string | null {
  return response.headers.get('X-Page-Next') || null
}

/** Output schema for the `nextPage` cursor, shared by the paged tools. */
export const downdetectorNextPageOutput = {
  type: 'string',
  description: 'Cursor to pass back as the next page (X-Page-Next); null when on the last page',
  optional: true,
} as const

/**
 * Trim, validate, and URL-encode a required path parameter. Throws a clear error
 * when the value is empty or whitespace-only so the tool never issues a malformed
 * request like `/companies//status`.
 */
export function encodePathParam(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${name} is required`)
  }
  return encodeURIComponent(trimmed)
}

/** Standard request headers for the Downdetector API (Bearer auth). */
export function downdetectorHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

/**
 * Extract a human-readable error message from a Downdetector error response.
 * The API returns `{ error: true, message: string }` on failure.
 */
export function extractDowndetectorError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return fallback
}
