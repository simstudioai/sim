import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import {
  type AppSession,
  extractSessionDataFromAuthClientResult,
} from '@/lib/auth/session-response'

export const SESSION_STALE_TIME = 5 * 60 * 1000

export const sessionKeys = {
  all: ['session'] as const,
  detail: () => [...sessionKeys.all, 'detail'] as const,
}

async function fetchSession(
  signal?: AbortSignal,
  disableCookieCache?: boolean
): Promise<AppSession> {
  const res = await client.getSession({
    ...(disableCookieCache ? { query: { disableCookieCache: true } } : {}),
    fetchOptions: { signal },
  })
  return extractSessionDataFromAuthClientResult(res) as AppSession
}

/**
 * Refreshes the canonical session cache from server truth.
 *
 * Better Auth's cookie cache may still contain the pre-mutation session, so
 * mutation flows that can change session fields must bypass it before updating
 * the shared React Query entry.
 */
export async function refreshSessionQuery(queryClient: QueryClient): Promise<AppSession> {
  await queryClient.cancelQueries({ queryKey: sessionKeys.detail() })

  const res = await client.getSession({ query: { disableCookieCache: true } })
  const fresh = extractSessionDataFromAuthClientResult(res) as AppSession

  queryClient.setQueryData(sessionKeys.detail(), fresh)

  return fresh
}

export const IMPERSONATION_REFETCH_INTERVAL = 60 * 1000

/**
 * Reads the current Better Auth session via the client SDK.
 *
 * This is the Better Auth client SDK (not a same-origin `requestJson` contract),
 * so a plain `useQuery` is correct — there is no boundary contract to bind.
 *
 * `retry: false` preserves the prior fail-fast contract: an auth failure (expired
 * token, startup network partition) surfaces immediately rather than retrying a
 * request that won't succeed.
 *
 * Every session refetches on focus (overriding the global
 * `refetchOnWindowFocus: false`) so a session that expired or was revoked while
 * the app sat mounted — the long-lived desktop window, a browser tab left open
 * for weeks, a laptop slept through the session's 30-day lifetime — settles the
 * query to `null` and surfaces {@link SessionExpired} instead of leaving an SPA
 * that silently 401s every request. Returning to the window is exactly the
 * moment that needs re-checking, and `SESSION_STALE_TIME` throttles it to at
 * most one read per 5 minutes of focus changes.
 *
 * Impersonation sessions additionally poll, and bypass Better Auth's cookie
 * cache: it can otherwise keep vouching for a session that was expired or
 * revoked server-side, and these sessions are short-lived enough that the
 * cache's own TTL would outlive them. Normal sessions accept that lag — a
 * revocation surfaces once the cache expires.
 */
export function useSessionQuery() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: sessionKeys.detail(),
    queryFn: ({ signal }) => {
      const cached = queryClient.getQueryData<AppSession>(sessionKeys.detail())
      return fetchSession(signal, Boolean(cached?.session?.impersonatedBy))
    },
    staleTime: SESSION_STALE_TIME,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.session?.impersonatedBy ? IMPERSONATION_REFETCH_INTERVAL : false,
    refetchOnWindowFocus: true,
  })
}
