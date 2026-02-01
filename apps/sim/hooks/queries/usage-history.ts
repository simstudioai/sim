import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import type { UsageLogSource, UsageLogsResult } from '@/lib/billing/core/usage-log'

export const usageHistoryKeys = {
  all: ['usage-history'] as const,
  list: (filters: UsageHistoryFilters) => [...usageHistoryKeys.all, 'list', filters] as const,
}

export interface UsageHistoryFilters {
  source?: UsageLogSource
  workspaceId?: string
  startDate?: string
  endDate?: string
}

interface UsageHistoryPage {
  logs: UsageLogsResult['logs']
  summary: UsageLogsResult['summary']
  nextCursor?: string
  hasMore: boolean
}

async function fetchUsageHistoryPage(
  filters: UsageHistoryFilters,
  cursor?: string
): Promise<UsageHistoryPage> {
  const params = new URLSearchParams()
  params.set('limit', '25')

  if (filters.source) {
    params.set('source', filters.source)
  }

  if (filters.workspaceId) {
    params.set('workspaceId', filters.workspaceId)
  }

  if (filters.startDate) {
    params.set('startDate', filters.startDate)
  }

  if (filters.endDate) {
    params.set('endDate', filters.endDate)
  }

  if (cursor) {
    params.set('cursor', cursor)
  }

  const response = await fetch(`/api/billing/usage-history?${params.toString()}`)

  if (!response.ok) {
    throw new Error('Failed to fetch usage history')
  }

  const { data } = await response.json()

  return {
    logs: data.logs,
    summary: data.summary,
    nextCursor: data.pagination.nextCursor,
    hasMore: data.pagination.hasMore,
  }
}

interface UseUsageHistoryOptions {
  enabled?: boolean
}

export function useUsageHistory(filters: UsageHistoryFilters, options?: UseUsageHistoryOptions) {
  return useInfiniteQuery({
    queryKey: usageHistoryKeys.list(filters),
    queryFn: ({ pageParam }) => fetchUsageHistoryPage(filters, pageParam),
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  })
}
