import { headers } from 'next/headers'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

/**
 * Server-side GET against an internal `/api` route, forwarding the incoming
 * request's cookie so the route authenticates as the current user.
 *
 * The legacy path. Reading the data layer and shaping the result through the
 * route's response contract — as `files/prefetch.ts` does — is canonical: it
 * drops a server-to-server request and its duplicate auth, and the contract
 * parse is what guarantees the hydrated entry matches a client fetch. Prefetches
 * still on this helper have not been converted; a converted one must prove the
 * viewer itself, since the route's own authorization no longer runs.
 */
export async function prefetchInternalJson<T>(path: string): Promise<T> {
  const cookie = (await headers()).get('cookie')
  // boundary-raw-fetch: server-side RSC prefetch forwarding the session cookie to an internal API route; requestJson is client-only and cannot run here
  const response = await fetch(`${getInternalApiBaseUrl()}${path}`, {
    headers: cookie ? { cookie } : {},
  })
  if (!response.ok) {
    throw new Error(`Prefetch failed for ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}
