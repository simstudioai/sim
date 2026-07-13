import { type QueryClient, useQuery } from '@tanstack/react-query'
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

async function fetchSession(signal?: AbortSignal): Promise<AppSession> {
  const res = await client.getSession({ fetchOptions: { signal } })
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

/**
 * Reads the current Better Auth session via the client SDK.
 *
 * This is the Better Auth client SDK (not a same-origin `requestJson` contract),
 * so a plain `useQuery` is correct — there is no boundary contract to bind.
 *
 * `retry: false` preserves the prior fail-fast contract: an auth failure (expired
 * token, startup network partition) surfaces immediately rather than retrying a
 * request that won't succeed.
 */
export function useSessionQuery() {
  return useQuery({
    queryKey: sessionKeys.detail(),
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: SESSION_STALE_TIME,
    retry: false,
  })
}
