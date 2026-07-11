import type { QueryClient } from '@tanstack/react-query'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { getUserProfile, getUserSettings } from '@/lib/users/queries'
import {
  GENERAL_SETTINGS_STALE_TIME,
  generalSettingsKeys,
  mapGeneralSettingsResponse,
} from '@/hooks/queries/general-settings'
import { SUBSCRIPTION_DATA_STALE_TIME, subscriptionKeys } from '@/hooks/queries/subscription'
import {
  mapUserProfileResponse,
  USER_PROFILE_STALE_TIME,
  userProfileKeys,
} from '@/hooks/queries/user-profile'

/**
 * Prefetch general settings server-side via the shared data layer.
 * Uses the same query keys as the client `useGeneralSettings` hook
 * so data is shared via HydrationBoundary.
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

/**
 * Prefetch subscription data server-side. Unlike the other prefetches this goes
 * through the internal billing API rather than calling the data layer directly:
 * the billing summary contains `Date` fields (and an untyped `metadata` blob) that
 * `NextResponse.json` serializes to the string wire shape the client caches. Going
 * through the route yields that exact shape, avoiding a Date-vs-string mismatch
 * between server-hydrated and client-fetched data. Uses the same query key as the
 * client `useSubscriptionData` hook (with includeOrg=false) so data is shared via
 * HydrationBoundary.
 */
export function prefetchSubscriptionData(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: subscriptionKeys.user(false),
    queryFn: async () => {
      const h = await headers()
      const cookie = h.get('cookie')
      const response = await fetch(`${getInternalApiBaseUrl()}/api/billing?context=user`, {
        headers: cookie ? { cookie } : {},
      })
      if (!response.ok) throw new Error(`Subscription prefetch failed: ${response.status}`)
      return response.json()
    },
    staleTime: SUBSCRIPTION_DATA_STALE_TIME,
  })
}

/**
 * Prefetch user profile server-side via the shared data layer.
 * Uses the same query keys as the client `useUserProfile` hook
 * so data is shared via HydrationBoundary.
 */
export function prefetchUserProfile(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: userProfileKeys.profile(),
    queryFn: async () => {
      const session = await getSession()
      if (!session?.user?.id) throw new Error('Unauthorized')
      const user = await getUserProfile(session.user.id)
      if (!user) throw new Error('User not found')
      return mapUserProfileResponse(user)
    },
    staleTime: USER_PROFILE_STALE_TIME,
  })
}
