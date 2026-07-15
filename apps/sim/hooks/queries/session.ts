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
 * While the session is an impersonation session, the query polls and refetches
 * on focus (overriding the global `refetchOnWindowFocus: false`) so an expiry —
 * including one slept through with the laptop closed — settles the query to
 * `null` and surfaces the impersonation-expired recovery screen. Those
 * refetches also bypass Better Auth's cookie cache: it can otherwise keep
 * vouching for a session that was expired or revoked server-side, and the
 * expiry detection shouldn't depend on the cache's own TTL details.
 * Impersonation sessions are short-lived and admin-only, so none of these
 * overrides affect normal sessions.
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
    refetchOnWindowFocus: (query) => Boolean(query.state.data?.session?.impersonatedBy),
  })
}
