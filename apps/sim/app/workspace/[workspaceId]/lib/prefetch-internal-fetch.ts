import { createLogger } from '@sim/logger'
import { headers } from 'next/headers'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('PrefetchInternalFetch')

/**
 * Server-side GET against an internal `/api` route, forwarding the incoming request's cookie
 * so the route authenticates as the current user.
 *
 * Only the tables list still needs this. `lib/table/service` transitively imports the
 * executor, so reading `listTables` from a `page.tsx` pulls the tool registry into that
 * route's graph and `bun run check:tool-registry-boundary` rejects it.
 *
 * Failures are logged: `prefetchQuery` swallows the rejection and `shouldDehydrateQuery`
 * drops the errored entry, so without this a failure silently ships a page missing that list.
 */
export async function prefetchInternalJson<T>(path: string): Promise<T> {
  const cookie = (await headers()).get('cookie')
  // boundary-raw-fetch: server-side RSC prefetch forwarding the session cookie to an internal API route; requestJson is client-only and cannot run here
  const response = await fetch(`${getInternalApiBaseUrl()}${path}`, {
    headers: cookie ? { cookie } : {},
  })
  if (!response.ok) {
    logger.error('Prefetch request failed; the list will client-fetch instead', {
      path,
      status: response.status,
    })
    throw new Error(`Prefetch failed for ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}
