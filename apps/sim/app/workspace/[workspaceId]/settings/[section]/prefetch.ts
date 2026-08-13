import type { QueryClient } from '@tanstack/react-query'
import { getSession } from '@/lib/auth'
import { getUserSettings } from '@/lib/users/queries'
import {
  GENERAL_SETTINGS_STALE_TIME,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
} from '@/hooks/queries/general-settings'

/**
 * Prefetch general settings server-side via the shared data layer.
 *
 * Uses the same query key and mapper as the client `useGeneralSettings` hook, so the
 * hydrated entry is indistinguishable from one a client fetch produced.
 *
 * Callers must `await` this. An unawaited prefetch is still `pending` when `dehydrate`
 * runs, and a pending query is shipped with its promise — so a rejection would hydrate
 * the client query into an error state that `retryOnMount: false` never retries, leaving
 * the panel broken for the rest of the session.
 */
export function prefetchGeneralSettings(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async () => {
      const session = await getSession()
      const data = await getUserSettings(session?.user?.id ?? null)
      return mapGeneralSettingsResponse(data)
    },
    staleTime: GENERAL_SETTINGS_STALE_TIME,
  })
}
