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
 * Callers must `await` this. Only a settled query is dehydrated, so an unawaited prefetch
 * is dropped from the payload entirely and the panel waterfalls on every load as if it had
 * never been prefetched.
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
