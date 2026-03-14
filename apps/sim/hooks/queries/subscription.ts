import type { QueryClient } from '@tanstack/react-query'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { organizationKeys } from '@/hooks/queries/organization'

/**
 * Shape of the usage object returned from the billing API (user context)
 */
export interface BillingUsageData {
  current: number
  limit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  lastPeriodCost: number
  lastPeriodCopilotCost: number
  daysRemaining: number
  copilotCost: number
  currentCredits: number
  limitCredits: number
  lastPeriodCostCredits: number
  lastPeriodCopilotCostCredits: number
  copilotCostCredits: number
}

/**
 * Shape of the billing data returned for the user context
 */
export interface SubscriptionBillingData {
  type: 'individual' | 'organization'
  plan: string
  basePrice: number
  currentUsage: number
  overageAmount: number
  totalProjected: number
  usageLimit: number
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  daysRemaining: number
  creditBalance: number
  billingInterval: 'month' | 'year'
  tierCredits: number
  basePriceCredits: number
  currentUsageCredits: number
  overageAmountCredits: number
  totalProjectedCredits: number
  usageLimitCredits: number
  isPaid: boolean
  isPro: boolean
  isTeam: boolean
  isEnterprise: boolean
  status: string | null
  seats: number | null
  stripeSubscriptionId: string | null
  periodEnd: string | null
  cancelAtPeriodEnd?: boolean
  usage: BillingUsageData
  billingBlocked?: boolean
  billingBlockedReason?: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner?: boolean
  organization?: { id: string; role: 'owner' | 'admin' | 'member' }
  organizationData?: {
    seatCount: number
    memberCount: number
    totalBasePrice: number
    totalCurrentUsage: number
    totalOverage: number
    totalBasePriceCredits: number
    totalCurrentUsageCredits: number
    totalOverageCredits: number
  }
}

/**
 * Shape of the full API response from GET /api/billing?context=user
 */
export interface SubscriptionApiResponse {
  success: boolean
  context: string
  data: SubscriptionBillingData
}

/**
 * Query key factories for subscription-related queries
 */
export const subscriptionKeys = {
  all: ['subscription'] as const,
  users: () => [...subscriptionKeys.all, 'user'] as const,
  user: (includeOrg?: boolean) => [...subscriptionKeys.users(), { includeOrg }] as const,
  usage: () => [...subscriptionKeys.all, 'usage'] as const,
}

/**
 * Fetch user subscription data
 * @param includeOrg - Whether to include organization role data
 */
async function fetchSubscriptionData(
  includeOrg = false,
  signal?: AbortSignal
): Promise<SubscriptionApiResponse> {
  const params = new URLSearchParams({ context: 'user' })
  if (includeOrg) params.set('includeOrg', 'true')

  const response = await fetch(`/api/billing?${params}`, { signal })
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
  /** Override default staleTime (defaults to 30s) */
  staleTime?: number
}

/**
 * Hook to fetch user subscription data
 * @param options - Optional configuration
 */
export function useSubscriptionData(options: UseSubscriptionDataOptions = {}) {
  const { includeOrg = false, enabled = true, staleTime = 30 * 1000 } = options

  return useQuery({
    queryKey: subscriptionKeys.user(includeOrg),
    queryFn: ({ signal }) => fetchSubscriptionData(includeOrg, signal),
    staleTime,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Prefetch subscription data into a QueryClient cache.
 * Use on hover to warm data before navigation.
 */
export function prefetchSubscriptionData(queryClient: QueryClient) {
  queryClient.prefetchQuery({
    queryKey: subscriptionKeys.user(false),
    queryFn: () => fetchSubscriptionData(false),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetch user usage limit metadata
 * Note: This endpoint returns limit information (currentLimit, minimumLimit, canEdit, etc.)
 * For actual usage data (current, limit, percentUsed), use useSubscriptionData() instead
 */
async function fetchUsageLimitData(signal?: AbortSignal) {
  const response = await fetch('/api/usage?context=user', { signal })
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
    queryFn: ({ signal }) => fetchUsageLimitData(signal),
    staleTime: 30 * 1000,
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

/**
 * Purchase credits mutation
 */
interface PurchaseCreditsParams {
  amount: number
  requestId: string
}

export function usePurchaseCredits() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ amount, requestId }: PurchaseCreditsParams) => {
      const response = await fetch('/api/billing/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, requestId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to purchase credits')
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.users() })
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.usage() })
    },
  })
}

/**
 * Open billing portal mutation
 */
interface OpenBillingPortalParams {
  context: 'user' | 'organization'
  organizationId?: string
  returnUrl: string
}

export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: async ({ context, organizationId, returnUrl }: OpenBillingPortalParams) => {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, organizationId, returnUrl }),
      })

      const data = await response.json()

      if (!response.ok || !data?.url) {
        throw new Error(data?.error || 'Failed to start billing portal')
      }

      return data as { url: string }
    },
  })
}
