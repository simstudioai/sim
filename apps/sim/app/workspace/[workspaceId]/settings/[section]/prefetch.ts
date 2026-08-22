import type { QueryClient } from '@tanstack/react-query'
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
 * The authenticated caller supplies the viewer ID it already resolved. Re-reading the session
 * inside the query would add another dependency to a prefetch that is deliberately started as
 * soon as workspace access succeeds.
 *
 * Callers must await the returned promise before dehydration. Only a settled query is included
 * by the current dehydration policy, so dropping the promise would leave the panel to fetch on
 * the client as if it had never been prefetched.
 */
export function prefetchGeneralSettings(queryClient: QueryClient, userId: string) {
  return queryClient.prefetchQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async () => {
      const data = await getUserSettings(userId)
      return mapGeneralSettingsResponse(data)
    },
    staleTime: GENERAL_SETTINGS_STALE_TIME,
  })
}
