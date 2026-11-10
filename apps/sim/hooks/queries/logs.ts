import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type DashboardStatsResponse,
  type ExecutionSnapshotData,
  getDashboardStatsContract,
  getExecutionSnapshotContract,
  getLogByExecutionIdContract,
  getLogDetailContract,
  type ListLogsQuery,
  listLogsContract,
  type WorkflowLogDetail,
  type WorkflowLogSummary,
} from '@/lib/api/contracts/logs'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/time-range'
import { logKeys } from '@/hooks/queries/utils/log-keys'
import type { TimeRange } from '@/stores/logs/filters/types'

export type { DashboardStatsResponse }

type LogSortBy = 'date' | 'duration' | 'cost' | 'status'
export type LogSortOrder = 'asc' | 'desc'

export const LOG_LIST_STALE_TIME = 30 * 1000
export const LOG_SNAPSHOT_STALE_TIME = 'static' as const
export const NEW_LOG_COUNT_STALE_TIME = 10 * 1000
export const LOG_SNAPSHOT_UPDATES_STALE_TIME = 60 * 1000
export const LOG_DETAIL_STALE_TIME = 30 * 1000
export const LOG_BY_EXECUTION_STALE_TIME = 30 * 1000
export const LOG_DASHBOARD_STATS_STALE_TIME = 30 * 1000
export const EXECUTION_SNAPSHOT_STALE_TIME = 5 * 60 * 1000
const CANCELLATION_POLL_INTERVAL_MS = 750
const CANCELLATION_POLL_ATTEMPTS = 20

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

function buildListQuery(
  workspaceId: string,
  filters: LogFilters,
  cursor: string | null
): ListLogsQuery {
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
  logs: WorkflowLogSummary[]
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
    logs: apiData.data,
    nextCursor: apiData.nextCursor,
  }
}

export async function fetchLogDetail(
  logId: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkflowLogDetail> {
  const { data } = await requestJson(getLogDetailContract, {
    params: { id: logId },
    query: { workspaceId },
    signal,
  })
  return data
}

/** One log row by its id; a 404 is an answer, so it is not retried. */
export function useLogDetail(workspaceId: string, logId: string | undefined) {
  return useQuery({
    queryKey: logKeys.detail(workspaceId, logId),
    queryFn: logId ? ({ signal }) => fetchLogDetail(logId, workspaceId, signal) : skipToken,
    staleTime: LOG_DETAIL_STALE_TIME,
    retry: (failureCount, error) =>
      !(isApiClientError(error) && error.status === 404) && failureCount < 3,
  })
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
    staleTime: LOG_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

interface LogSnapshotCursor {
  cursor: string
  snapshotAt?: string
  revision?: string
  query: ListLogsQuery
}

export interface LogSnapshotPage extends LogsPage {
  snapshotAt?: string
  revision?: string
  query: ListLogsQuery
  snapshotChanged: boolean
}

/** Keeps the displayed list stable until an explicit refresh, including across focus and invalidation. */
export function useLogsSnapshot(
  workspaceId: string | undefined,
  filters: LogFilters,
  options?: Pick<UseLogsListOptions, 'enabled'>
) {
  return useInfiniteQuery({
    queryKey: logKeys.snapshot(workspaceId, filters),
    queryFn: async ({ pageParam, signal }): Promise<LogSnapshotPage> => {
      const query = pageParam?.query ?? buildListQuery(workspaceId as string, filters, null)
      const result = await requestJson(listLogsContract, {
        query: {
          ...query,
          cursor: pageParam?.cursor,
          snapshotAt: pageParam?.snapshotAt ?? 'now',
          includeRevision: true,
        },
        signal,
      })
      const snapshotChanged = Boolean(pageParam && result.revision !== pageParam.revision)
      return {
        logs: snapshotChanged ? [] : result.data,
        nextCursor: snapshotChanged ? null : result.nextCursor,
        snapshotAt: result.snapshotAt,
        revision: result.revision,
        query,
        snapshotChanged,
      }
    },
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: LOG_SNAPSHOT_STALE_TIME,
    placeholderData: keepPreviousData,
    initialPageParam: null as LogSnapshotCursor | null,
    getNextPageParam: (lastPage): LogSnapshotCursor | undefined =>
      lastPage.nextCursor
        ? {
            cursor: lastPage.nextCursor,
            snapshotAt: lastPage.snapshotAt,
            revision: lastPage.revision,
            query: lastPage.query,
          }
        : undefined,
  })
}

/**
 * Trims a held snapshot to its first page, so the refetch that follows reads one page instead of
 * every page read so far; later pages load again as the reader nears the end.
 */
export function trimLogsSnapshotToFirstPage(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  filters: LogFilters
) {
  queryClient.setQueryData<InfiniteData<LogSnapshotPage, LogSnapshotCursor | null>>(
    logKeys.snapshot(workspaceId, filters),
    (data) =>
      data && data.pages.length > 1
        ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
        : data
  )
}

/**
 * Joins the runs that started since a newest-first snapshot was taken to its head, reading one page
 * and a revision count instead of every page held, so a reader deep in the list keeps their place.
 * The fresh first page replaces the held copies of the runs it carries, so a run that changed near
 * the head shows its new state, and the later pages keep their cursors into the held snapshot.
 *
 * Changes nothing and answers false when only reading every page again is exact: the list is not
 * newest first or holds one page; the held snapshot no longer reads as it did (a run joined, left
 * or moved at or before its instant); more runs started than one page holds, leaving a gap; or the
 * snapshot changed while the merge read.
 */
export async function mergeNewLogsIntoSnapshot(
  queryClient: QueryClient,
  workspaceId: string | undefined,
  filters: LogFilters
): Promise<boolean> {
  const key = logKeys.snapshot(workspaceId, filters)
  const held =
    queryClient.getQueryData<InfiniteData<LogSnapshotPage, LogSnapshotCursor | null>>(key)
  const head = held?.pages[0]
  if (
    !workspaceId ||
    !held ||
    !head?.revision ||
    !head.snapshotAt ||
    held.pages.length < 2 ||
    filters.sortBy !== 'date' ||
    filters.sortOrder !== 'desc'
  )
    return false
  const [fresh, recheck] = await Promise.all([
    requestJson(listLogsContract, {
      query: { ...head.query, snapshotAt: 'now', includeRevision: true },
    }),
    requestJson(listLogsContract, {
      query: { ...head.query, snapshotAt: head.snapshotAt, countOnly: true, includeRevision: true },
    }),
  ])
  if (recheck.revision !== head.revision) return false
  const freshIds = new Set(fresh.data.map((log) => log.id))
  const reachesHeld =
    fresh.nextCursor === null ||
    held.pages.some((page) => page.logs.some((log) => freshIds.has(log.id)))
  if (!reachesHeld || queryClient.getQueryData(key) !== held) return false
  queryClient.setQueryData<InfiniteData<LogSnapshotPage, LogSnapshotCursor | null>>(key, {
    pages: held.pages.map((page, index) => {
      const kept = page.logs.filter((log) => !freshIds.has(log.id))
      return index === 0
        ? {
            ...page,
            logs: [...fresh.data, ...kept],
            snapshotAt: fresh.snapshotAt,
            revision: fresh.revision,
          }
        : { ...page, logs: kept }
    }),
    pageParams: held.pageParams,
  })
  return true
}

/** Checks older matching rows for late visibility or sort changes, stopping once refresh is needed. */
export function useLogSnapshotUpdates(
  workspaceId: string | undefined,
  snapshot: LogSnapshotPage | undefined,
  options?: Pick<UseLogsListOptions, 'enabled'>
) {
  return useQuery({
    queryKey: logKeys.update(workspaceId, snapshot),
    queryFn: async ({ signal }) => {
      const result = await requestJson(listLogsContract, {
        query: {
          ...snapshot?.query,
          workspaceId: workspaceId as string,
          snapshotAt: snapshot?.snapshotAt,
          countOnly: true,
          includeRevision: true,
        },
        signal,
      })
      return result.revision !== snapshot?.revision
    },
    enabled: (query) =>
      Boolean(workspaceId) &&
      Boolean(snapshot?.revision) &&
      (options?.enabled ?? true) &&
      query.state.data !== true,
    initialData: false,
    staleTime: LOG_SNAPSHOT_UPDATES_STALE_TIME,
    refetchInterval: (query) => (query.state.data ? false : LOG_SNAPSHOT_UPDATES_STALE_TIME),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/** Polls only the count of new matching runs; it never writes to the displayed list. */
export function useNewLogCount(
  workspaceId: string | undefined,
  filters: LogFilters,
  snapshotAt: string | undefined,
  options?: Pick<UseLogsListOptions, 'enabled'>
) {
  return useQuery({
    queryKey: logKeys.newCount(workspaceId, filters, snapshotAt),
    queryFn: async ({ signal }) => {
      const result = await requestJson(listLogsContract, {
        query: {
          ...buildListQuery(workspaceId as string, filters, null),
          countOnly: true,
          startedAfter: snapshotAt,
        },
        signal,
      })
      return result.total ?? 0
    },
    enabled: Boolean(workspaceId) && Boolean(snapshotAt) && (options?.enabled ?? true),
    staleTime: NEW_LOG_COUNT_STALE_TIME,
    refetchInterval: NEW_LOG_COUNT_STALE_TIME,
  })
}

interface UseLogDetailOptions {
  enabled?: boolean
  refetchInterval?:
    | number
    | false
    | ((query: { state: { data?: WorkflowLogDetail } }) => number | false | undefined)
}

async function fetchLogByExecutionId(
  workspaceId: string,
  executionId: string,
  signal?: AbortSignal
): Promise<WorkflowLogDetail> {
  const { data } = await requestJson(getLogByExecutionIdContract, {
    params: { executionId },
    query: { workspaceId },
    signal,
  })
  return data
}

export function useLogByExecutionId(
  workspaceId: string | undefined,
  executionId: string | null | undefined,
  options?: Pick<UseLogDetailOptions, 'refetchInterval'>
) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: logKeys.byExecution(workspaceId, executionId ?? undefined),
    queryFn: async ({ signal }) => {
      const data = await fetchLogByExecutionId(workspaceId as string, executionId as string, signal)
      queryClient.setQueryData(logKeys.detail(workspaceId, data.id), data)
      return data
    },
    enabled: Boolean(workspaceId) && Boolean(executionId),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: LOG_BY_EXECUTION_STALE_TIME,
  })
}

async function pollForTerminalExecution(params: {
  queryClient: QueryClient
  workspaceId: string
  executionId: string
}): Promise<void> {
  const { queryClient, workspaceId, executionId } = params
  let lastPollingError: unknown

  for (let attempt = 0; attempt < CANCELLATION_POLL_ATTEMPTS; attempt++) {
    let detail: WorkflowLogDetail | undefined
    try {
      detail = await fetchLogByExecutionId(workspaceId, executionId)
      lastPollingError = undefined
    } catch (error) {
      lastPollingError = error
    }

    if (detail) {
      queryClient.setQueryData(logKeys.byExecution(workspaceId, executionId), detail)
      queryClient.setQueryData(logKeys.detail(workspaceId, detail.id), detail)
      const confirmedDetail = detail
      /** Reconcile the acted-on row without inserting new runs into a manual snapshot. */
      queryClient.setQueriesData<InfiniteData<LogsPage>>({ queryKey: logKeys.lists() }, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            logs: page.logs.map((log) =>
              log.executionId === executionId
                ? {
                    ...log,
                    status: confirmedDetail.status,
                    level: confirmedDetail.level,
                    duration: confirmedDetail.duration,
                    cost: confirmedDetail.cost,
                    pauseSummary: confirmedDetail.pauseSummary,
                    hasPendingPause: confirmedDetail.hasPendingPause,
                  }
                : log
            ),
          })),
        }
      })
    }

    await queryClient.invalidateQueries({ queryKey: logKeys.lists(), refetchType: 'active' })
    if (detail?.status === 'cancelled') return
    if (detail?.status === 'completed' || detail?.status === 'failed') {
      throw new Error(`Run finished as ${detail.status} before cancellation was confirmed`)
    }
    if (attempt < CANCELLATION_POLL_ATTEMPTS - 1) {
      await sleep(CANCELLATION_POLL_INTERVAL_MS)
    }
  }

  if (lastPollingError) {
    throw new Error(
      `Unable to confirm that the run stopped: ${getErrorMessage(lastPollingError, 'log lookup failed')}`
    )
  }
  throw new Error('Run stop was requested, but cancellation was not confirmed in time')
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
    staleTime: LOG_DASHBOARD_STATS_STALE_TIME,
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
    staleTime: EXECUTION_SNAPSHOT_STALE_TIME,
  })
}

export function useCancelExecution(workspaceId: string) {
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
      if (!data.success) {
        throw new Error(
          data.reason ? `Run stop was not confirmed: ${data.reason}` : 'Run stop was not confirmed'
        )
      }
      await pollForTerminalExecution({ queryClient, workspaceId, executionId })
      return data
    },
    onMutate: async ({ executionId }) => {
      await queryClient.cancelQueries({ queryKey: logKeys.lists() })

      const previousQueries = queryClient.getQueriesData<InfiniteData<LogsPage>>({
        queryKey: logKeys.lists(),
      })

      let affectedLogId: string | null = null
      queryClient.setQueriesData<InfiniteData<LogsPage>>({ queryKey: logKeys.lists() }, (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            logs: page.logs.map((log) => {
              if (log.executionId !== executionId) return log
              affectedLogId = log.id
              return { ...log, status: 'cancelling' }
            }),
          })),
        }
      })

      let previousDetail: WorkflowLogDetail | undefined
      if (affectedLogId) {
        previousDetail = queryClient.getQueryData<WorkflowLogDetail>(
          logKeys.detail(workspaceId, affectedLogId)
        )
        if (previousDetail) {
          queryClient.setQueryData<WorkflowLogDetail>(logKeys.detail(workspaceId, affectedLogId), {
            ...previousDetail,
            status: 'cancelling',
          })
        }
      }

      return { previousQueries, affectedLogId, previousDetail }
    },
    onError: (_err, { executionId }, context) => {
      for (const [queryKey, data] of context?.previousQueries ?? []) {
        const previousLog = data?.pages
          .find((page) => page.logs.some((log) => log.executionId === executionId))
          ?.logs.find((log) => log.executionId === executionId)
        if (!previousLog) continue
        queryClient.setQueryData<InfiniteData<LogsPage>>(queryKey, (current) => {
          if (!current) return current
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              logs: page.logs.map((log) =>
                log.executionId === executionId && log.status === 'cancelling' ? previousLog : log
              ),
            })),
          }
        })
      }
      if (context?.affectedLogId && context.previousDetail !== undefined) {
        queryClient.setQueryData<WorkflowLogDetail>(
          logKeys.detail(workspaceId, context.affectedLogId),
          (current) => (current?.status === 'cancelling' ? context.previousDetail : current)
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: logKeys.lists() })
      queryClient.invalidateQueries({ queryKey: logKeys.details() })
      queryClient.invalidateQueries({ queryKey: logKeys.byExecutionAll() })
      queryClient.invalidateQueries({ queryKey: logKeys.stats() })
    },
  })
}

export function useRetryExecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workflowId,
      executionId,
    }: {
      workflowId: string
      executionId: string
    }) => {
      // boundary-raw-fetch: stream response, body is a ReadableStream consumed one chunk at a time
      const res = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputFromExecutionId: executionId,
          triggerType: 'manual',
          stream: true,
        }),
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
      queryClient.invalidateQueries({ queryKey: logKeys.byExecutionAll() })
      queryClient.invalidateQueries({ queryKey: logKeys.stats() })
    },
  })
}
