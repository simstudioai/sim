import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import type {
  DashboardStatsResponse,
  SegmentStats,
  WorkflowStats,
} from '@/app/api/logs/stats/route'
import type { LogsResponse, TimeRange, WorkflowLog } from '@/stores/logs/filters/types'

export type { DashboardStatsResponse, SegmentStats, WorkflowStats }

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: Omit<LogFilters, 'page'>) =>
    [...logKeys.lists(), workspaceId ?? '', filters] as const,
  recent: (workspaceId: string | undefined, limit: number) =>
    [...logKeys.all, 'recent', workspaceId ?? '', limit] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (logId: string | undefined) => [...logKeys.details(), logId ?? ''] as const,
  stats: (workspaceId: string | undefined, filters: object) =>
    [...logKeys.all, 'stats', workspaceId ?? '', filters] as const,
  executionSnapshots: () => [...logKeys.all, 'executionSnapshot'] as const,
  executionSnapshot: (executionId: string | undefined) =>
    [...logKeys.executionSnapshots(), executionId ?? ''] as const,
}

interface LogFilters {
  timeRange: TimeRange
  startDate?: string
  endDate?: string
  level: string
  workflowIds: string[]
  folderIds: string[]
  triggers: string[]
  searchQuery: string
  limit: number
}

/**
 * Applies common filter parameters to a URLSearchParams object.
 * Shared between paginated and non-paginated log fetches.
 */
function applyFilterParams(params: URLSearchParams, filters: Omit<LogFilters, 'limit'>): void {
  if (filters.level !== 'all') {
    params.set('level', filters.level)
  }

  if (filters.triggers.length > 0) {
    params.set('triggers', filters.triggers.join(','))
  }

  if (filters.workflowIds.length > 0) {
    params.set('workflowIds', filters.workflowIds.join(','))
  }

  if (filters.folderIds.length > 0) {
    params.set('folderIds', filters.folderIds.join(','))
  }

  const startDate = getStartDateFromTimeRange(filters.timeRange, filters.startDate)
  if (startDate) {
    params.set('startDate', startDate.toISOString())
  }

  const endDate = getEndDateFromTimeRange(filters.timeRange, filters.endDate)
  if (endDate) {
    params.set('endDate', endDate.toISOString())
  }

  if (filters.searchQuery.trim()) {
    const parsedQuery = parseQuery(filters.searchQuery.trim())
    const searchParams = queryToApiParams(parsedQuery)

    for (const [key, value] of Object.entries(searchParams)) {
      params.set(key, value)
    }
  }
}

function buildQueryParams(workspaceId: string, filters: LogFilters, page: number): string {
  const params = new URLSearchParams()

  params.set('workspaceId', workspaceId)
  params.set('limit', filters.limit.toString())
  params.set('offset', ((page - 1) * filters.limit).toString())

  applyFilterParams(params, filters)

  return params.toString()
}

async function fetchLogsPage(
  workspaceId: string,
  filters: LogFilters,
  page: number
): Promise<{ logs: WorkflowLog[]; hasMore: boolean; nextPage: number | undefined }> {
  const queryParams = buildQueryParams(workspaceId, filters, page)
  const response = await fetch(`/api/logs?${queryParams}`)

  if (!response.ok) {
    throw new Error('Failed to fetch logs')
  }

  const apiData: LogsResponse = await response.json()
  const hasMore = apiData.data.length === filters.limit && apiData.page < apiData.totalPages

  return {
    logs: apiData.data || [],
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

async function fetchLogDetail(logId: string): Promise<WorkflowLog> {
  const response = await fetch(`/api/logs/${logId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch log details')
  }

  const { data } = await response.json()
  return data
}

interface UseLogsListOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useLogsList(
  workspaceId: string | undefined,
  filters: LogFilters,
  options?: UseLogsListOptions
) {
  return useInfiniteQuery({
    queryKey: logKeys.list(workspaceId, filters),
    queryFn: ({ pageParam }) => fetchLogsPage(workspaceId as string, filters, pageParam),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0,
    placeholderData: keepPreviousData,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  })
}

interface UseLogDetailOptions {
  enabled?: boolean
  refetchInterval?:
    | number
    | false
    | ((query: { state: { data?: WorkflowLog } }) => number | false | undefined)
}

export function useLogDetail(logId: string | undefined, options?: UseLogDetailOptions) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => fetchLogDetail(logId as string),
    enabled: Boolean(logId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 30 * 1000,
    initialData: () => {
      if (!logId) return undefined
      const listQueries = queryClient.getQueriesData<{
        pages: { logs: WorkflowLog[] }[]
      }>({
        queryKey: logKeys.lists(),
      })
      for (const [, data] of listQueries) {
        const match = data?.pages?.flatMap((p) => p.logs).find((l) => l.id === logId)
        if (match) return match
      }
      return undefined
    },
    initialDataUpdatedAt: 0,
  })
}

/**
 * Prefetches log detail data on hover for instant panel rendering on click.
 */
export function prefetchLogDetail(queryClient: QueryClient, logId: string) {
  queryClient.prefetchQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => fetchLogDetail(logId),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetches dashboard stats from the server-side aggregation endpoint.
 * Uses SQL aggregation for efficient computation without arbitrary limits.
 */
async function fetchDashboardStats(
  workspaceId: string,
  filters: Omit<LogFilters, 'limit'>
): Promise<DashboardStatsResponse> {
  const params = new URLSearchParams()
  params.set('workspaceId', workspaceId)

  applyFilterParams(params, filters)

  const response = await fetch(`/api/logs/stats?${params.toString()}`)

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard stats')
  }

  return response.json()
}

interface UseDashboardStatsOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

/**
 * Hook for fetching dashboard stats using server-side aggregation.
 * No arbitrary limits - uses SQL aggregation for accurate metrics.
 */
export function useDashboardStats(
  workspaceId: string | undefined,
  filters: Omit<LogFilters, 'limit'>,
  options?: UseDashboardStatsOptions
) {
  return useQuery({
    queryKey: logKeys.stats(workspaceId, filters),
    queryFn: () => fetchDashboardStats(workspaceId as string, filters),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}

export interface ExecutionSnapshotData {
  executionId: string
  workflowId: string
  workflowState: Record<string, unknown>
  childWorkflowSnapshots?: Record<string, Record<string, unknown>>
  executionMetadata: {
    trigger: string
    startedAt: string
    endedAt?: string
    totalDurationMs?: number
    cost: {
      total: number | null
      input: number | null
      output: number | null
    }
    totalTokens: number | null
  }
}

async function fetchExecutionSnapshot(executionId: string): Promise<ExecutionSnapshotData> {
  const response = await fetch(`/api/logs/execution/${executionId}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch execution snapshot: ${response.statusText}`)
  }

  const data = await response.json()
  if (!data) {
    throw new Error('No execution snapshot data returned')
  }

  return data
}

export function useExecutionSnapshot(executionId: string | undefined) {
  return useQuery({
    queryKey: logKeys.executionSnapshot(executionId),
    queryFn: () => fetchExecutionSnapshot(executionId as string),
    enabled: Boolean(executionId),
    staleTime: 5 * 60 * 1000, // 5 minutes - execution snapshots don't change
  })
}

/**
 * Simple recent logs data for lightweight use cases (e.g., mention suggestions)
 */
export interface RecentLog {
  id: string
  executionId?: string
  level: string
  trigger: string | null
  createdAt: string
  workflow?: {
    name?: string
    title?: string
  }
  workflowName?: string
}

async function fetchRecentLogs(workspaceId: string, limit: number): Promise<RecentLog[]> {
  const params = new URLSearchParams()
  params.set('workspaceId', workspaceId)
  params.set('limit', limit.toString())
  params.set('details', 'full')

  const response = await fetch(`/api/logs?${params.toString()}`)

  if (!response.ok) {
    throw new Error('Failed to fetch recent logs')
  }

  const data = await response.json()
  return Array.isArray(data?.data) ? data.data : []
}

interface UseRecentLogsOptions {
  enabled?: boolean
}

/**
 * Hook for fetching recent logs with minimal filtering.
 * Useful for lightweight use cases like mention suggestions.
 */
export function useRecentLogs(
  workspaceId: string | undefined,
  limit = 50,
  options?: UseRecentLogsOptions
) {
  return useQuery({
    queryKey: logKeys.recent(workspaceId, limit),
    queryFn: () => fetchRecentLogs(workspaceId as string, limit),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}
