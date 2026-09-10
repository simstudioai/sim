import { z } from 'zod'

export const SEARCH_CONNECTION_ATTEMPT_MAX_AGE_MS = 10 * 60_000
export const SEARCH_CONNECTION_ATTEMPT_EVENT = 'sim:search-connection-attempt'
const attemptSchema = z.object({
  completionId: z.string().uuid(),
  requestedAt: z.number(),
  connectorId: z.string().optional(),
  credentialId: z.string().optional(),
  status: z.enum(['pending', 'connected', 'failed']),
  error: z.string().nullable(),
})
export type SearchConnectionAttempt = z.infer<typeof attemptSchema>

/** Local presentation state, namespaced by the person, organization, and individual card. */
export function searchConnectionAttemptKey(
  organizationId: string,
  userId: string,
  controlId: string
) {
  return `sim.search-connection.${encodeURIComponent(organizationId)}.${encodeURIComponent(userId)}.${encodeURIComponent(controlId)}`
}

export function readSearchConnectionAttempt(key: string): SearchConnectionAttempt | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(key)
  if (!value) return null
  return attemptSchema.parse(JSON.parse(value))
}

export function writeSearchConnectionAttempt(key: string, value: SearchConnectionAttempt) {
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new Event(SEARCH_CONNECTION_ATTEMPT_EVENT))
}
