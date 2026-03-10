import type { QueryClient } from '@tanstack/react-query'
import { headers } from 'next/headers'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { generalSettingsKeys } from '@/hooks/queries/general-settings'
import { userProfileKeys } from '@/hooks/queries/user-profile'

/**
 * Forwards incoming request cookies so server-side API fetches authenticate correctly.
 */
async function getForwardedHeaders(): Promise<Record<string, string>> {
  const h = await headers()
  const cookie = h.get('cookie')
  return cookie ? { cookie } : {}
}

/**
 * Prefetch general settings server-side via internal API fetch.
 * Uses the same query keys as the client `useGeneralSettings` hook
 * so data is shared via HydrationBoundary.
 */
export function prefetchGeneralSettings(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: generalSettingsKeys.settings(),
    queryFn: async () => {
      const fwdHeaders = await getForwardedHeaders()
      const baseUrl = getInternalApiBaseUrl()
      const response = await fetch(`${baseUrl}/api/users/me/settings`, {
        headers: fwdHeaders,
      })
      if (!response.ok) throw new Error(`Settings prefetch failed: ${response.status}`)
      const { data } = await response.json()
      return {
        autoConnect: data.autoConnect ?? true,
        showTrainingControls: data.showTrainingControls ?? false,
        superUserModeEnabled: data.superUserModeEnabled ?? true,
        theme: data.theme || 'system',
        telemetryEnabled: data.telemetryEnabled ?? true,
        billingUsageNotificationsEnabled: data.billingUsageNotificationsEnabled ?? true,
        errorNotificationsEnabled: data.errorNotificationsEnabled ?? true,
        snapToGridSize: data.snapToGridSize ?? 0,
        showActionBar: data.showActionBar ?? true,
      }
    },
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Prefetch user profile server-side via internal API fetch.
 * Uses the same query keys as the client `useUserProfile` hook
 * so data is shared via HydrationBoundary.
 */
export function prefetchUserProfile(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: userProfileKeys.profile(),
    queryFn: async () => {
      const fwdHeaders = await getForwardedHeaders()
      const baseUrl = getInternalApiBaseUrl()
      const response = await fetch(`${baseUrl}/api/users/me/profile`, {
        headers: fwdHeaders,
      })
      if (!response.ok) throw new Error(`Profile prefetch failed: ${response.status}`)
      const { user } = await response.json()
      return {
        id: user.id,
        name: user.name || '',
        email: user.email || '',
        image: user.image || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}
