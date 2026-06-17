import { dbReplica } from '@sim/db'
import type { QueryClient } from '@tanstack/react-query'
import { getSession } from '@/lib/auth'
import { getEffectiveBillingStatus } from '@/lib/billing/core/access'
import { getSimplifiedBillingSummary } from '@/lib/billing/core/billing'
import { getUserProfile, getUserSettings } from '@/lib/users/queries'
import { generalSettingsKeys, mapGeneralSettingsResponse } from '@/hooks/queries/general-settings'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { mapUserProfileResponse, userProfileKeys } from '@/hooks/queries/user-profile'

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
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Prefetch subscription data server-side via the shared data layer.
 * Uses the same query key as the client `useSubscriptionData` hook (with includeOrg=false)
 * so data is shared via HydrationBoundary — ensuring the settings sidebar renders
 * with the correct Team/Enterprise tabs on the first paint, with no flash.
 */
export function prefetchSubscriptionData(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: subscriptionKeys.user(false),
    queryFn: async () => {
      const session = await getSession()
      if (!session?.user?.id) throw new Error('Unauthorized')
      const [summary, status] = await Promise.all([
        getSimplifiedBillingSummary(session.user.id, undefined, dbReplica),
        getEffectiveBillingStatus(session.user.id),
      ])
      return {
        success: true,
        context: 'user' as const,
        data: {
          ...summary,
          billingBlocked: status.billingBlocked,
          billingBlockedReason: status.billingBlockedReason,
          blockedByOrgOwner: status.blockedByOrgOwner,
        },
      }
    },
    staleTime: 5 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
  })
}
