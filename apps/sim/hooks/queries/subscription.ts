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
    onMutate: async ({ limit }) => {
      await queryClient.cancelQueries({ queryKey: subscriptionKeys.user() })
      await queryClient.cancelQueries({ queryKey: subscriptionKeys.usage() })

      const previousSubscriptionData = queryClient.getQueryData(subscriptionKeys.user())
      const previousUsageData = queryClient.getQueryData(subscriptionKeys.usage())

      queryClient.setQueryData(subscriptionKeys.user(), (old: any) => {
        if (!old) return old
        const currentUsage = old.data?.usage?.current || 0
        const newPercentUsed = limit > 0 ? (currentUsage / limit) * 100 : 0

        return {
          ...old,
          data: {
            ...old.data,
            usage: {
              ...old.data?.usage,
              limit,
              percentUsed: newPercentUsed,
            },
          },
        }
      })

      queryClient.setQueryData(subscriptionKeys.usage(), (old: any) => {
        if (!old) return old
        return {
          ...old,
          data: {
            ...old.data,
            currentLimit: limit,
          },
        }
      })

      return { previousSubscriptionData, previousUsageData }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSubscriptionData) {
        queryClient.setQueryData(subscriptionKeys.user(), context.previousSubscriptionData)
      }
      if (context?.previousUsageData) {
        queryClient.setQueryData(subscriptionKeys.usage(), context.previousUsageData)
      }
    },
    onSettled: () => {
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
      return { plan }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })

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
