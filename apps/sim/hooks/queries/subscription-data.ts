import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getUserBillingContract,
  type SubscriptionApiResponse,
} from '@/lib/api/contracts/subscription'
import { subscriptionKeys } from '@/hooks/queries/utils/subscription-keys'

export const SUBSCRIPTION_DATA_STALE_TIME = 5 * 60 * 1000

async function fetchSubscriptionData(
  includeOrg = false,
  signal?: AbortSignal
): Promise<SubscriptionApiResponse> {
  return requestJson(getUserBillingContract, {
    query: { context: 'user', includeOrg },
    signal,
  })
}

export function subscriptionDataQueryOptions(
  includeOrg = false,
  staleTime = SUBSCRIPTION_DATA_STALE_TIME
) {
  return queryOptions({
    queryKey: subscriptionKeys.user(includeOrg),
    queryFn: ({ signal }) => fetchSubscriptionData(includeOrg, signal),
    retryOnMount: true,
    staleTime,
  })
}
