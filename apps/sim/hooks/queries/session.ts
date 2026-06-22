import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'
import { extractSessionDataFromAuthClientResult } from '@/lib/auth/session-response'
import type { AppSession } from '@/app/_shell/providers/session-provider'

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
 */
export function useSessionQuery() {
  return useQuery({
    queryKey: sessionKeys.detail(),
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 5 * 60 * 1000,
  })
}
