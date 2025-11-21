import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import type { LogsResponse, WorkflowLog } from '@/stores/logs/filters/types'

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: Omit<LogFilters, 'page'>) =>
    [...logKeys.lists(), workspaceId ?? '', filters] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (logId: string | undefined) => [...logKeys.details(), logId ?? ''] as const,
  metrics: () => [...logKeys.all, 'metrics'] as const,
  executions: (workspaceId: string | undefined, filters: Record<string, any>) =>
    [...logKeys.metrics(), 'executions', workspaceId ?? '', filters] as const,
  workflowLogs: (
    workspaceId: string | undefined,
    workflowId: string | undefined,
    filters: Record<string, any>
  ) => [...logKeys.all, 'workflow-logs', workspaceId ?? '', workflowId ?? '', filters] as const,
  globalLogs: (workspaceId: string | undefined, filters: Record<string, any>) =>
    [...logKeys.all, 'global-logs', workspaceId ?? '', filters] as const,
}

interface LogFilters {
  timeRange: string
  level: string
  workflowIds: string[]
  folderIds: string[]
  triggers: string[]
  searchQuery: string
  limit: number
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

function buildQueryParams(workspaceId: string, filters: LogFilters, page: number): string {
  const params = new URLSearchParams()

  params.set('workspaceId', workspaceId)
  params.set('limit', filters.limit.toString())
  params.set('offset', ((page - 1) * filters.limit).toString())

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

  if (filters.timeRange !== 'All time') {
    const now = new Date()
    let startDate: Date

    switch (filters.timeRange) {
      case 'Past 30 minutes':
        startDate = new Date(now.getTime() - 30 * 60 * 1000)
        break
      case 'Past hour':
        startDate = new Date(now.getTime() - 60 * 60 * 1000)
        break
      case 'Past 6 hours':
        startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000)
        break
      case 'Past 12 hours':
        startDate = new Date(now.getTime() - 12 * 60 * 60 * 1000)
        break
      case 'Past 24 hours':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case 'Past 3 days':
        startDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
        break
      case 'Past 7 days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'Past 14 days':
        startDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
        break
      case 'Past 30 days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(0)
    }

    params.set('startDate', startDate.toISOString())
  }

  if (filters.searchQuery.trim()) {
    const parsedQuery = parseQuery(filters.searchQuery.trim())
    const searchParams = queryToApiParams(parsedQuery)

    for (const [key, value] of Object.entries(searchParams)) {
      params.set(key, value)
    }
  }

  return params.toString()
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
    staleTime: 0, // Always consider stale for real-time logs
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  })
}

export function useLogDetail(logId: string | undefined) {
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => fetchLogDetail(logId as string),
    enabled: Boolean(logId),
    staleTime: 30 * 1000, // Details can be slightly stale (30 seconds)
    placeholderData: keepPreviousData,
  })
}

interface WorkflowSegment {
  timestamp: string
  hasExecutions: boolean
  totalExecutions: number
  successfulExecutions: number
  successRate: number
  avgDurationMs?: number
  p50Ms?: number
  p90Ms?: number
  p99Ms?: number
}

interface WorkflowExecution {
  workflowId: string
  workflowName: string
  segments: WorkflowSegment[]
  overallSuccessRate: number
}

interface AggregateSegment {
  timestamp: string
  totalExecutions: number
  successfulExecutions: number
}

interface ExecutionsMetricsResponse {
  workflows: WorkflowExecution[]
  aggregateSegments: AggregateSegment[]
}

interface DashboardMetricsFilters {
  workspaceId: string
  segments: number
  startTime: string
  endTime: string
  workflowIds?: string[]
  folderIds?: string[]
  triggers?: string[]
}

async function fetchExecutionsMetrics(
  filters: DashboardMetricsFilters
): Promise<ExecutionsMetricsResponse> {
  const params = new URLSearchParams({
    segments: String(filters.segments),
    startTime: filters.startTime,
    endTime: filters.endTime,
  })

  if (filters.workflowIds && filters.workflowIds.length > 0) {
    params.set('workflowIds', filters.workflowIds.join(','))
  }

  if (filters.folderIds && filters.folderIds.length > 0) {
    params.set('folderIds', filters.folderIds.join(','))
  }

  if (filters.triggers && filters.triggers.length > 0) {
    params.set('triggers', filters.triggers.join(','))
  }

  const response = await fetch(
    `/api/workspaces/${filters.workspaceId}/metrics/executions?${params.toString()}`
  )

  if (!response.ok) {
    throw new Error('Failed to fetch execution metrics')
  }

  const data = await response.json()

  const workflows: WorkflowExecution[] = (data.workflows || []).map((wf: any) => {
    const segments = (wf.segments || []).map((s: any) => {
      const total = s.totalExecutions || 0
      const success = s.successfulExecutions || 0
      const hasExecutions = total > 0
      const successRate = hasExecutions ? (success / total) * 100 : 100
      return {
        timestamp: s.timestamp,
        hasExecutions,
        totalExecutions: total,
        successfulExecutions: success,
        successRate,
        avgDurationMs: typeof s.avgDurationMs === 'number' ? s.avgDurationMs : 0,
        p50Ms: typeof s.p50Ms === 'number' ? s.p50Ms : 0,
        p90Ms: typeof s.p90Ms === 'number' ? s.p90Ms : 0,
        p99Ms: typeof s.p99Ms === 'number' ? s.p99Ms : 0,
      }
    })

    const totals = segments.reduce(
      (acc: { total: number; success: number }, seg: WorkflowSegment) => {
        acc.total += seg.totalExecutions
        acc.success += seg.successfulExecutions
        return acc
      },
      { total: 0, success: 0 }
    )

    const overallSuccessRate = totals.total > 0 ? (totals.success / totals.total) * 100 : 100

    return {
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
      segments,
      overallSuccessRate,
    }
  })

  const sortedWorkflows = workflows.sort((a, b) => {
    const errA = a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
    const errB = b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
    return errB - errA
  })

  const segmentCount = filters.segments
  const startTime = new Date(filters.startTime)
  const endTime = new Date(filters.endTime)

  const aggregateSegments: AggregateSegment[] = Array.from({ length: segmentCount }, (_, i) => {
    const base = startTime.getTime()
    const ts = new Date(base + Math.floor((i * (endTime.getTime() - base)) / segmentCount))
    return {
      timestamp: ts.toISOString(),
      totalExecutions: 0,
      successfulExecutions: 0,
    }
  })

  for (const wf of data.workflows as any[]) {
    wf.segments.forEach((s: any, i: number) => {
      const index = Math.min(i, segmentCount - 1)
      aggregateSegments[index].totalExecutions += s.totalExecutions || 0
      aggregateSegments[index].successfulExecutions += s.successfulExecutions || 0
    })
  }

  return {
    workflows: sortedWorkflows,
    aggregateSegments,
  }
}

interface UseExecutionsMetricsOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useExecutionsMetrics(
  filters: DashboardMetricsFilters,
  options?: UseExecutionsMetricsOptions
) {
  return useQuery({
    queryKey: logKeys.executions(filters.workspaceId, filters),
    queryFn: () => fetchExecutionsMetrics(filters),
    enabled: Boolean(filters.workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 10 * 1000, // Metrics can be slightly stale (10 seconds)
    placeholderData: keepPreviousData,
  })
}

interface DashboardLogsFilters {
  workspaceId: string
  startDate: string
  endDate: string
  workflowIds?: string[]
  folderIds?: string[]
  triggers?: string[]
  limit: number
}

interface DashboardLogsPage {
  logs: any[] // Will be mapped by the consumer
  hasMore: boolean
  nextPage: number | undefined
}

async function fetchDashboardLogsPage(
  filters: DashboardLogsFilters,
  page: number,
  workflowId?: string
): Promise<DashboardLogsPage> {
  const params = new URLSearchParams({
    limit: filters.limit.toString(),
    offset: ((page - 1) * filters.limit).toString(),
    workspaceId: filters.workspaceId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    order: 'desc',
    details: 'full',
  })

  if (workflowId) {
    params.set('workflowIds', workflowId)
  } else if (filters.workflowIds && filters.workflowIds.length > 0) {
    params.set('workflowIds', filters.workflowIds.join(','))
  }

  if (filters.folderIds && filters.folderIds.length > 0) {
    params.set('folderIds', filters.folderIds.join(','))
  }

  if (filters.triggers && filters.triggers.length > 0) {
    params.set('triggers', filters.triggers.join(','))
  }

  const response = await fetch(`/api/logs?${params.toString()}`)

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard logs')
  }

  const data = await response.json()
  const logs = data.data || []
  const hasMore = logs.length === filters.limit

  return {
    logs,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

interface UseDashboardLogsOptions {
  enabled?: boolean
}

export function useGlobalDashboardLogs(
  filters: DashboardLogsFilters,
  options?: UseDashboardLogsOptions
) {
  return useInfiniteQuery({
    queryKey: logKeys.globalLogs(filters.workspaceId, filters),
    queryFn: ({ pageParam }) => fetchDashboardLogsPage(filters, pageParam),
    enabled: Boolean(filters.workspaceId) && (options?.enabled ?? true),
    staleTime: 10 * 1000, // Slightly stale (10 seconds)
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  })
}

export function useWorkflowDashboardLogs(
  workflowId: string | undefined,
  filters: DashboardLogsFilters,
  options?: UseDashboardLogsOptions
) {
  return useInfiniteQuery({
    queryKey: logKeys.workflowLogs(filters.workspaceId, workflowId, filters),
    queryFn: ({ pageParam }) => fetchDashboardLogsPage(filters, pageParam, workflowId),
    enabled: Boolean(filters.workspaceId) && Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 10 * 1000, // Slightly stale (10 seconds)
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  })
}
