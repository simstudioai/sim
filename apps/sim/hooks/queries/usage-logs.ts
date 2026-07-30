'use client'

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getUsageLogsContract,
  type UsageLogPeriod,
  type UsageLogsApiResponse,
} from '@/lib/api/contracts/user'
import { usageLogKeys } from '@/hooks/queries/utils/usage-log-keys'

const PAGE_SIZE = 25

export const USAGE_LOGS_LIST_STALE_TIME = 30 * 1000
export const USAGE_SUMMARY_STALE_TIME = 30 * 1000

interface UsagePeriodFilter {
  period: UsageLogPeriod
  /** Required when `period` is `'custom'`. */
  startDate?: string
  /** Required when `period` is `'custom'`. */
  endDate?: string
}

async function fetchUsageLogs(
  filter: UsagePeriodFilter,
  limit: number,
  cursor: string | undefined,
  signal?: AbortSignal,
  includeCredits = true
): Promise<UsageLogsApiResponse> {
  return requestJson(getUsageLogsContract, {
    query: { ...filter, limit, cursor, includeCredits },
    signal,
  })
}

interface UseUsageLogsOptions extends UsagePeriodFilter {
  enabled?: boolean
}

/**
 * Infinite-scrolls the authenticated user's credit-consuming usage events for
 * the Credit usage page, keyset-paginated by the backend's opaque
 * `nextCursor`. Keeps the prior filter's rows on screen while a newly
 * selected period/range loads, since the filter is a variable key.
 */
export function useUsageLogs({ period, startDate, endDate, enabled = true }: UseUsageLogsOptions) {
  return useInfiniteQuery({
    queryKey: usageLogKeys.list(period, undefined, { startDate, endDate }),
    queryFn: ({ pageParam, signal }) =>
      fetchUsageLogs({ period, startDate, endDate }, PAGE_SIZE, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled,
    staleTime: USAGE_LOGS_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/**
 * Fetches just the total-credits summary for a fixed period — the compact
 * Billing settings glance doesn't need the paginated row list, so this skips
 * the infinite-query machinery and asks the backend for a single minimal page.
 */
export function useUsageSummary(period: Exclude<UsageLogPeriod, 'custom'>) {
  return useQuery({
    queryKey: usageLogKeys.summary(period),
    queryFn: ({ signal }) => fetchUsageLogs({ period }, 1, undefined, signal, false),
    staleTime: USAGE_SUMMARY_STALE_TIME,
    select: (data) => data.summary.totalCredits,
  })
}
