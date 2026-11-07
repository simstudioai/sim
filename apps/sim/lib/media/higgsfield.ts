/** Higgsfield platform API shared by the video and image generation providers. */
export const HIGGSFIELD_API_BASE = 'https://api.higgsfield.ai'

/** Higgsfield authenticates with `Authorization: Key <key-id>:<key-secret>`. */
export function higgsfieldAuthHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Key ${apiKey.trim()}`, Accept: 'application/json' }
}

/** Polling URL for a submitted Higgsfield request; the ID is encoded since it comes from the response. */
export function higgsfieldStatusUrl(requestId: string): string {
  return `${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(requestId)}/status`
}

/** Request statuses after which Higgsfield never changes the request again. */
export const HIGGSFIELD_FAILED_STATUSES = ['failed', 'nsfw', 'canceled'] as const

/**
 * User-facing error for a terminal failed status, preferring the provider's own error text for a
 * plain failure.
 */
export function higgsfieldFailureMessage(status: string, error: unknown): string {
  if (status === 'nsfw') return 'Higgsfield rejected the request in content moderation'
  if (status === 'canceled') return 'The Higgsfield request was canceled'
  return typeof error === 'string' && error ? error : 'Higgsfield generation failed'
}
