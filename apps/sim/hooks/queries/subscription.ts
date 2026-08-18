import type { QueryClient } from '@tanstack/react-query'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  createBillingPortalContract,
  getInvoicesContract,
  getUserBillingContract,
  getUserUsageLimitContract,
  type InvoicesApiResponse,
  type SubscriptionApiResponse,
  updateUsageLimitContract,
} from '@/lib/api/contracts/subscription'
import { invalidateWorkspaceUsage } from '@/hooks/queries/utils/invalidate-usage'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'

export type { SubscriptionApiResponse }

export const SUBSCRIPTION_DATA_STALE_TIME = 5 * 60 * 1000
export const USAGE_LIMIT_STALE_TIME = 30 * 1000
export const INVOICES_STALE_TIME = 5 * 60 * 1000

/**
 * Fetch user subscription data
 * @param includeOrg - Whether to include organization role data
 */
async function fetchSubscriptionData(
  includeOrg = false,
  signal?: AbortSignal
): Promise<SubscriptionApiResponse> {
  return requestJson(getUserBillingContract, {
    query: { context: 'user', includeOrg },
    signal,
  })
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
  const { includeOrg = false, enabled = true, staleTime = SUBSCRIPTION_DATA_STALE_TIME } = options

  return useQuery({
    queryKey: subscriptionKeys.user(includeOrg),
    queryFn: ({ signal }) => fetchSubscriptionData(includeOrg, signal),
    staleTime,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Prefetch the billing queries the Upgrade page gates on: the
 * organization-scoped subscription variant (`includeOrg: true`, a different
 * cache key than the credits chip's `false` variant) and the usage-limit
 * metadata. Use on hover to warm both before navigating to `/upgrade`.
 *
 * Org-scoped subscribers additionally gate on the organization-billing query,
 * which is intentionally not prewarmed here: its key depends on the resolved
 * billing organization id, which is only derivable after the subscription and
 * workspace queries land, so it cannot be warmed at hover time.
 */
export function prefetchUpgradeBillingData(queryClient: QueryClient) {
  queryClient.prefetchQuery({
    queryKey: subscriptionKeys.user(true),
    queryFn: ({ signal }) => fetchSubscriptionData(true, signal),
    staleTime: SUBSCRIPTION_DATA_STALE_TIME,
  })
  queryClient.prefetchQuery({
    queryKey: subscriptionKeys.usage(),
    queryFn: ({ signal }) => fetchUsageLimitData(signal),
    staleTime: USAGE_LIMIT_STALE_TIME,
  })
}

/**
 * Fetch user usage limit metadata
 * Note: This endpoint returns limit information (currentLimit, minimumLimit, canEdit, etc.)
 * For actual usage data (current, limit, percentUsed), use useSubscriptionData() instead
 */
async function fetchUsageLimitData(signal?: AbortSignal) {
  return requestJson(getUserUsageLimitContract, {
    query: { context: 'user' },
    signal,
  })
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
    staleTime: USAGE_LIMIT_STALE_TIME,
    enabled,
  })
}

/**
 * Fetch finalized invoices for the active billing customer (personal or
 * organization-scoped).
 */
async function fetchInvoices(
  context: 'user' | 'organization',
  organizationId: string | undefined,
  signal?: AbortSignal
): Promise<InvoicesApiResponse> {
  return requestJson(getInvoicesContract, {
    query: { context, organizationId },
    signal,
  })
}

interface UseInvoicesOptions {
  /** Billing context to read invoices for (defaults to the personal customer). */
  context?: 'user' | 'organization'
  /** Required when `context` is `organization`. */
  organizationId?: string
  /** Whether to enable the query (defaults to true). */
  enabled?: boolean
}

/**
 * Hook to fetch finalized Stripe invoices for the current billing customer.
 * Returns an empty list when there is no customer or Stripe is not configured.
 */
export function useInvoices(options: UseInvoicesOptions = {}) {
  const { context = 'user', organizationId, enabled = true } = options

  return useQuery({
    queryKey: subscriptionKeys.invoices(context, organizationId),
    queryFn: ({ signal }) => fetchInvoices(context, organizationId, signal),
    staleTime: INVOICES_STALE_TIME,
    enabled: enabled && (context !== 'organization' || Boolean(organizationId)),
  })
}

/**
 * Update usage limit mutation
 */
interface UpdateUsageLimitParams {
  limit: ContractBodyInput<typeof updateUsageLimitContract>['limit']
}

export function useUpdateUsageLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ limit }: UpdateUsageLimitParams) => {
      return requestJson(updateUsageLimitContract, {
        body: { context: 'user', limit },
      })
    },
    onMutate: async ({ limit }) => {
      await queryClient.cancelQueries({ queryKey: subscriptionKeys.all })

      const previousSubscriptionData = queryClient.getQueryData(subscriptionKeys.user(false))
      const previousSubscriptionDataWithOrg = queryClient.getQueryData(subscriptionKeys.user(true))
      const previousUsageData = queryClient.getQueryData(subscriptionKeys.usage())

      const updateSubscriptionData = (old: SubscriptionApiResponse | undefined) => {
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

      queryClient.setQueryData<SubscriptionApiResponse | undefined>(
        subscriptionKeys.user(false),
        updateSubscriptionData
      )
      queryClient.setQueryData<SubscriptionApiResponse | undefined>(
        subscriptionKeys.user(true),
        updateSubscriptionData
      )

      queryClient.setQueryData<Awaited<ReturnType<typeof fetchUsageLimitData>> | undefined>(
        subscriptionKeys.usage(),
        (old) => {
          if (!old) return old
          return {
            ...old,
            data: {
              ...old.data,
              currentLimit: limit,
            },
          }
        }
      )

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
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.users() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.usage() }),
        invalidateWorkspaceUsage(queryClient),
      ])
    },
  })
}

/**
 * Open billing portal mutation
 */
type OpenBillingPortalParams = ContractBodyInput<typeof createBillingPortalContract>

export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: async (body: OpenBillingPortalParams) => {
      const data = await requestJson(createBillingPortalContract, {
        body,
      })

      return data
    },
  })
}
