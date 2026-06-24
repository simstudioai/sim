import { headers } from 'next/headers'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

/**
 * Server-side GET against an internal `/api` route, forwarding the incoming
 * request's cookie so the route authenticates as the current user.
 *
 * List prefetches go through the route (rather than the data layer) when the
 * payload carries `Date` fields: `NextResponse.json` serializes them to the
 * string wire shape the client caches via `requestJson`, so the
 * server-hydrated entry byte-matches the client-fetched one through
 * dehydration. Calling the data layer directly would cache raw `Date` objects
 * and drift from that wire shape. Mirrors the settings/subscription prefetch.
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
