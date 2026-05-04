import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  cancelWorkflowExecutionContract,
  type DashboardStatsResponse,
  type ExecutionSnapshotData,
  getDashboardStatsContract,
  getExecutionSnapshotContract,
  getLogDetailContract,
  listLogsContract,
  type SegmentStats,
  type WorkflowLogData,
  type WorkflowStats,
} from '@/lib/api/contracts/logs'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import type { TimeRange, WorkflowLog } from '@/stores/logs/filters/types'

export type { DashboardStatsResponse, SegmentStats, WorkflowStats }

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: Omit<LogFilters, 'page'>) =>
    [...logKeys.lists(), workspaceId ?? '', filters] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (logId: string | undefined) => [...logKeys.details(), logId ?? ''] as const,
  byExecutionAll: () => [...logKeys.all, 'byExecution'] as const,
  byExecution: (workspaceId: string | undefined, executionId: string | undefined) =>
    [...logKeys.byExecutionAll(), workspaceId ?? '', executionId ?? ''] as const,
  stats: () => [...logKeys.all, 'stats'] as const,
  stat: (workspaceId: string | undefined, filters: object) =>
    [...logKeys.stats(), workspaceId ?? '', filters] as const,
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

const toWorkflowLog = (log: WorkflowLogData): WorkflowLog => log as WorkflowLog

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

function buildQueryParams(workspaceId: string, filters: LogFilters, page: number) {
  const params = new URLSearchParams()

  applyFilterParams(params, filters)

  return {
    workspaceId,
    limit: filters.limit,
    offset: (page - 1) * filters.limit,
    ...Object.fromEntries(params.entries()),
  }
}

async function fetchLogsPage(
  workspaceId: string,
  filters: LogFilters,
  page: number,
  signal?: AbortSignal
): Promise<{ logs: WorkflowLog[]; hasMore: boolean; nextPage: number | undefined }> {
  const apiData = await requestJson(listLogsContract, {
    query: buildQueryParams(workspaceId, filters, page),
    signal,
  })
  const hasMore = apiData.data.length === filters.limit && apiData.page < apiData.totalPages

  return {
    logs: apiData.data.map(toWorkflowLog),
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

export async function fetchLogDetail(logId: string, signal?: AbortSignal): Promise<WorkflowLog> {
  const { data } = await requestJson(getLogDetailContract, {
    params: { id: logId },
    signal,
  })
  return toWorkflowLog(data)
}

async function fetchLogByExecutionId(
  workspaceId: string,
  executionId: string,
  signal?: AbortSignal
): Promise<WorkflowLog | null> {
  const apiData = await requestJson(listLogsContract, {
    query: {
      workspaceId,
      executionId,
      details: 'full',
      limit: 1,
    },
    signal,
  })
  return apiData.data?.[0] ? toWorkflowLog(apiData.data[0]) : null
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
    queryFn: ({ pageParam, signal }) =>
      fetchLogsPage(workspaceId as string, filters, pageParam, signal),
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
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: ({ signal }) => fetchLogDetail(logId as string, signal),
    enabled: Boolean(logId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 30 * 1000,
    retry: (failureCount, err) =>
      !(isApiClientError(err) && err.status === 404) && failureCount < 3,
  })
}

/**
 * Looks up a workflow log by its `executionId` (the id stored on table workflow cells).
 * Returns the full log shape so the LogDetails sidebar can render directly without
 * an extra detail fetch.
 */
export function useLogByExecutionId(
  workspaceId: string | undefined,
  executionId: string | null | undefined
) {
  return useQuery({
    queryKey: logKeys.byExecution(workspaceId, executionId ?? undefined),
    queryFn: ({ signal }) =>
      fetchLogByExecutionId(workspaceId as string, executionId as string, signal),
    enabled: Boolean(workspaceId) && Boolean(executionId),
    staleTime: 30 * 1000,
  })
}

/**
 * Prefetches log detail data on hover for instant panel rendering on click.
 */
export function prefetchLogDetail(queryClient: QueryClient, logId: string) {
  queryClient.prefetchQuery({
    queryKey: logKeys.detail(logId),
    queryFn: ({ signal }) => fetchLogDetail(logId, signal),
    staleTime: 30 * 1000,
  })
}

/**
 * Fetches dashboard stats from the server-side aggregation endpoint.
 * Uses SQL aggregation for efficient computation without arbitrary limits.
 */
async function fetchDashboardStats(
  workspaceId: string,
  filters: Omit<LogFilters, 'limit'>,
  signal?: AbortSignal
): Promise<DashboardStatsResponse> {
  const params = new URLSearchParams()
  applyFilterParams(params, filters)

  return requestJson(getDashboardStatsContract, {
    query: {
      workspaceId,
      ...Object.fromEntries(params.entries()),
    },
    signal,
  })
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
    queryKey: logKeys.stat(workspaceId, filters),
    queryFn: ({ signal }) => fetchDashboardStats(workspaceId as string, filters, signal),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}

export type { ExecutionSnapshotData }

async function fetchExecutionSnapshot(
  executionId: string,
  signal?: AbortSignal
): Promise<ExecutionSnapshotData> {
  const data = await requestJson(getExecutionSnapshotContract, {
    params: { executionId },
    signal,
  })
  if (!data) {
    throw new Error('No execution snapshot data returned')
  }

  return data
}

export function useExecutionSnapshot(executionId: string | undefined) {
  return useQuery({
    queryKey: logKeys.executionSnapshot(executionId),
    queryFn: ({ signal }) => fetchExecutionSnapshot(executionId as string, signal),
    enabled: Boolean(executionId),
    staleTime: 5 * 60 * 1000, // 5 minutes - execution snapshots don't change
  })
}

type LogsPage = { logs: WorkflowLog[]; hasMore: boolean; nextPage: number | undefined }

export function useCancelExecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workflowId,
      executionId,
    }: {
      workflowId: string
      executionId: string
    }) => {
      const data = await requestJson(cancelWorkflowExecutionContract, {
        params: { id: workflowId, executionId },
      })
      if (!data.success) throw new Error('Failed to cancel run')
      return data
    },
    onMutate: async ({ executionId }) => {
      await queryClient.cancelQueries({ queryKey: logKeys.lists() })

      const previousQueries = queryClient.getQueriesData<InfiniteData<LogsPage>>({
        queryKey: logKeys.lists(),
      })

      queryClient.setQueriesData<InfiniteData<LogsPage>>({ queryKey: logKeys.lists() }, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            logs: page.logs.map((log) =>
              log.executionId === executionId ? { ...log, status: 'cancelling' } : log
            ),
          })),
        }
      })

      return { previousQueries }
    },
    onError: (_err, _variables, context) => {
      for (const [queryKey, data] of context?.previousQueries ?? []) {
        queryClient.setQueryData(queryKey, data)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: logKeys.lists() })
      queryClient.invalidateQueries({ queryKey: logKeys.details() })
      queryClient.invalidateQueries({ queryKey: logKeys.stats() })
    },
  })
}

export function useRetryExecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workflowId, input }: { workflowId: string; input?: unknown }) => {
      // boundary-raw-fetch: stream response, body is a ReadableStream consumed one chunk at a time
      const res = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, triggerType: 'manual', stream: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to retry execution')
      }
      // The ReadableStream is lazy — start() only runs when read.
      // Read one chunk to trigger execution, then cancel. Execution continues
      // server-side after client disconnect.
      const reader = res.body?.getReader()
      if (reader) {
        await reader.read()
        reader.cancel()
      }
      return { started: true }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: logKeys.lists() })
      queryClient.invalidateQueries({ queryKey: logKeys.details() })
      queryClient.invalidateQueries({ queryKey: logKeys.stats() })
    },
  })
}
