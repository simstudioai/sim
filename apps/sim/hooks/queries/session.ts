import { useQuery } from '@tanstack/react-query'
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
