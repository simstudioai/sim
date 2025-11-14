import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { organizationKeys } from './organization'

/**
 * Query key factories for subscription-related queries
 */
export const subscriptionKeys = {
  all: ['subscription'] as const,
  user: () => [...subscriptionKeys.all, 'user'] as const,
  usage: () => [...subscriptionKeys.all, 'usage'] as const,
}

/**
 * Fetch user subscription data
 */
async function fetchSubscriptionData() {
  const response = await fetch('/api/billing?context=user')
  if (!response.ok) {
    throw new Error('Failed to fetch subscription data')
  }
  return response.json()
}

/**
 * Hook to fetch user subscription data
 */
export function useSubscriptionData() {
  return useQuery({
    queryKey: subscriptionKeys.user(),
    queryFn: fetchSubscriptionData,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetch user usage limit metadata
 * Note: This endpoint returns limit information (currentLimit, minimumLimit, canEdit, etc.)
 * For actual usage data (current, limit, percentUsed), use useSubscriptionData() instead
 */
async function fetchUsageLimitData() {
  const response = await fetch('/api/usage?context=user')
  if (!response.ok) {
    throw new Error('Failed to fetch usage limit data')
  }
  return response.json()
}

/**
 * Hook to fetch usage limit metadata
 * Returns: currentLimit, minimumLimit, canEdit, plan, updatedAt
 * Use this for editing usage limits, not for displaying current usage
 */
export function useUsageLimitData() {
  return useQuery({
    queryKey: subscriptionKeys.usage(),
    queryFn: fetchUsageLimitData,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Update usage limit mutation
 */
interface UpdateUsageLimitParams {
  limit: number
}

export function useUpdateUsageLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ limit }: UpdateUsageLimitParams) => {
      const response = await fetch('/api/usage?context=user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update usage limit')
      }

      return response.json()
    },
    onSuccess: () => {
      // Invalidate all subscription-related queries
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.user() })
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.usage() })
    },
  })
}

/**
 * Upgrade subscription mutation
 */
interface UpgradeSubscriptionParams {
  plan: string
  orgId?: string
}

export function useUpgradeSubscription() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ plan }: UpgradeSubscriptionParams) => {
      // This will be handled by the existing subscription upgrade flow
      // We just need to ensure proper cache invalidation
      return { plan }
    },
    onSuccess: (_data, variables) => {
      // Invalidate all subscription queries
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })

      // Also invalidate organization billing if org context
      if (variables.orgId) {
        queryClient.invalidateQueries({
          queryKey: organizationKeys.billing(variables.orgId),
        })
        queryClient.invalidateQueries({
          queryKey: organizationKeys.subscription(variables.orgId),
        })
      }
    },
  })
}
