'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getUsageLogsContract,
  type UsageLogPeriod,
  type UsageLogsApiResponse,
} from '@/lib/api/contracts/user'
import { usageLogKeys } from '@/hooks/queries/utils/usage-log-keys'

const PAGE_SIZE = 25

async function fetchUsageLogs(
  period: UsageLogPeriod,
  cursor: string | undefined,
  signal?: AbortSignal
): Promise<UsageLogsApiResponse> {
  return requestJson(getUsageLogsContract, {
    query: { period, limit: PAGE_SIZE, cursor },
    signal,
  })
}

interface UseUsageLogsOptions {
  period: UsageLogPeriod
  enabled?: boolean
}

/**
 * Infinite-scrolls the authenticated user's credit-consuming usage events for
 * the Billing settings "Credit usage" section, keyset-paginated by the
 * backend's opaque `nextCursor`.
 */
export function useUsageLogs({ period, enabled = true }: UseUsageLogsOptions) {
  return useInfiniteQuery({
    queryKey: usageLogKeys.list(period),
    queryFn: ({ pageParam, signal }) => fetchUsageLogs(period, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled,
    staleTime: 30 * 1000,
  })
}
