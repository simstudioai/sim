import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  cancelWorkflowExecutionContract,
  type DashboardStatsResponse,
  type ExecutionSnapshotData,
  getDashboardStatsContract,
  getExecutionSnapshotContract,
  getLogByExecutionIdContract,
  getLogDetailContract,
  listLogsContract,
  type SegmentStats,
  type WorkflowLogDetail,
  type WorkflowLogSummary,
  type WorkflowStats,
} from '@/lib/api/contracts/logs'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import type { TimeRange, WorkflowLog } from '@/stores/logs/filters/types'

export type { DashboardStatsResponse, SegmentStats, WorkflowStats }

export type LogSortBy = 'date' | 'duration' | 'cost' | 'status'
export type LogSortOrder = 'asc' | 'desc'

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: LogFilters) =>
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

export interface LogFilters {
  timeRange: TimeRange
  startDate?: string
  endDate?: string
  level: string
  workflowIds: string[]
  folderIds: string[]
  triggers: string[]
  searchQuery: string
  limit: number
  sortBy: LogSortBy
  sortOrder: LogSortOrder
}

// double-cast-allowed: bridge from contract type to legacy WorkflowLog used by stores/components
const summaryToWorkflowLog = (log: WorkflowLogSummary): WorkflowLog => log as unknown as WorkflowLog
// double-cast-allowed: bridge from contract type to legacy WorkflowLog used by stores/components
const detailToWorkflowLog = (log: WorkflowLogDetail): WorkflowLog => log as unknown as WorkflowLog

function applyFilterParams(
  params: URLSearchParams,
  filters: Omit<LogFilters, 'limit' | 'sortBy' | 'sortOrder'>
): void {
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

function buildListQuery(workspaceId: string, filters: LogFilters, cursor: string | null) {
  const params = new URLSearchParams()
  applyFilterParams(params, filters)

  return {
    workspaceId,
    limit: filters.limit,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    ...(cursor ? { cursor } : {}),
    ...Object.fromEntries(params.entries()),
  }
}

interface LogsPage {
  logs: WorkflowLog[]
  nextCursor: string | null
}

async function fetchLogsPage(
  workspaceId: string,
  filters: LogFilters,
  cursor: string | null,
  signal?: AbortSignal
): Promise<LogsPage> {
  const apiData = await requestJson(listLogsContract, {
    query: buildListQuery(workspaceId, filters, cursor),
    signal,
  })

  return {
    logs: apiData.data.map(summaryToWorkflowLog),
    nextCursor: apiData.nextCursor,
  }
}

export async function fetchLogDetail(
  logId: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkflowLog> {
  const { data } = await requestJson(getLogDetailContract, {
    params: { id: logId },
    query: { workspaceId },
    signal,
  })
  return detailToWorkflowLog(data)
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
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

interface UseLogDetailOptions {
  enabled?: boolean
  refetchInterval?:
    | number
    | false
    | ((query: { state: { data?: WorkflowLog } }) => number | false | undefined)
}

export function useLogDetail(
  logId: string | undefined,
  workspaceId: string | undefined,
  options?: UseLogDetailOptions
) {
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: ({ signal }) => fetchLogDetail(logId as string, workspaceId as string, signal),
    enabled: Boolean(logId) && Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 30 * 1000,
  })
}

/**
 * Looks up a workflow log by its `executionId`. Writes the resulting detail
 * through to the canonical `detail(id)` cache so subsequent `useLogDetail`
 * reads hit instantly.
 */
export function useLogByExecutionId(
  workspaceId: string | undefined,
  executionId: string | null | undefined
) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: logKeys.byExecution(workspaceId, executionId ?? undefined),
    queryFn: async ({ signal }) => {
      const { data } = await requestJson(getLogByExecutionIdContract, {
        params: { executionId: executionId as string },
        query: { workspaceId: workspaceId as string },
        signal,
      })
      const log = detailToWorkflowLog(data)
      queryClient.setQueryData(logKeys.detail(log.id), log)
      return log
    },
    enabled: Boolean(workspaceId) && Boolean(executionId),
    staleTime: 30 * 1000,
  })
}

export function prefetchLogDetail(queryClient: QueryClient, logId: string, workspaceId: string) {
  queryClient.prefetchQuery({
    queryKey: logKeys.detail(logId),
    queryFn: ({ signal }) => fetchLogDetail(logId, workspaceId, signal),
    staleTime: 30 * 1000,
  })
}

async function fetchDashboardStats(
  workspaceId: string,
  filters: Omit<LogFilters, 'limit' | 'sortBy' | 'sortOrder'>,
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

export function useDashboardStats(
  workspaceId: string | undefined,
  filters: Omit<LogFilters, 'limit' | 'sortBy' | 'sortOrder'>,
  options?: UseDashboardStatsOptions
) {
  return useQuery({
    queryKey: logKeys.stat(workspaceId, filters),
    queryFn: ({ signal }) => fetchDashboardStats(workspaceId as string, filters, signal),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 30 * 1000,
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
    staleTime: 5 * 60 * 1000,
  })
}

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
