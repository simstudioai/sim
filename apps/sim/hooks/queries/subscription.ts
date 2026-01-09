import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { organizationKeys } from '@/hooks/queries/organization'

/**
 * Query key factories for subscription-related queries
 */
export const subscriptionKeys = {
  all: ['subscription'] as const,
  user: (includeOrg?: boolean) => [...subscriptionKeys.all, 'user', { includeOrg }] as const,
  usage: () => [...subscriptionKeys.all, 'usage'] as const,
}

/**
 * Fetch user subscription data
 * @param includeOrg - Whether to include organization role data
 */
async function fetchSubscriptionData(includeOrg = false) {
  const params = new URLSearchParams({ context: 'user' })
  if (includeOrg) params.set('includeOrg', 'true')

  const response = await fetch(`/api/billing?${params}`)
  if (!response.ok) {
    throw new Error('Failed to fetch subscription data')
  }
  return response.json()
}

interface UseSubscriptionDataOptions {
  /** Include organization membership and role data */
  includeOrg?: boolean
  /** Whether to enable the query (defaults to true) */
  enabled?: boolean
}

/**
 * Hook to fetch user subscription data
 * @param options - Optional configuration
 */
export function useSubscriptionData(options: UseSubscriptionDataOptions = {}) {
  const { includeOrg = false, enabled = true } = options

  return useQuery({
    queryKey: subscriptionKeys.user(includeOrg),
    queryFn: () => fetchSubscriptionData(includeOrg),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    enabled,
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

interface UseUsageLimitDataOptions {
  /** Whether to enable the query (defaults to true) */
  enabled?: boolean
}

/**
 * Hook to fetch usage limit metadata
 * Returns: currentLimit, minimumLimit, canEdit, plan, updatedAt
 * Use this for editing usage limits, not for displaying current usage
 */
export function useUsageLimitData(options: UseUsageLimitDataOptions = {}) {
  const { enabled = true } = options

  return useQuery({
    queryKey: subscriptionKeys.usage(),
    queryFn: fetchUsageLimitData,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    enabled,
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
      await queryClient.cancelQueries({ queryKey: subscriptionKeys.all })

      const previousSubscriptionData = queryClient.getQueryData(subscriptionKeys.user(false))
      const previousSubscriptionDataWithOrg = queryClient.getQueryData(subscriptionKeys.user(true))
      const previousUsageData = queryClient.getQueryData(subscriptionKeys.usage())

      const updateSubscriptionData = (old: any) => {
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
      }

      queryClient.setQueryData(subscriptionKeys.user(false), updateSubscriptionData)
      queryClient.setQueryData(subscriptionKeys.user(true), updateSubscriptionData)

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

      return { previousSubscriptionData, previousSubscriptionDataWithOrg, previousUsageData }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSubscriptionData) {
        queryClient.setQueryData(subscriptionKeys.user(false), context.previousSubscriptionData)
      }
      if (context?.previousSubscriptionDataWithOrg) {
        queryClient.setQueryData(
          subscriptionKeys.user(true),
          context.previousSubscriptionDataWithOrg
        )
      }
      if (context?.previousUsageData) {
        queryClient.setQueryData(subscriptionKeys.usage(), context.previousUsageData)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
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
