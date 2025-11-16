import { useEffect } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { LogsResponse, WorkflowLog } from '@/stores/logs/filters/types'

const logger = createLogger('LogQueries')

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: Record<string, any>) =>
    [...logKeys.lists(), workspaceId ?? '', filters] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (logId: string | undefined) => [...logKeys.details(), logId ?? ''] as const,
}

interface LogFilters {
  timeRange: string
  level: string
  workflowIds: string[]
  folderIds: string[]
  triggers: string[]
  searchQuery: string
  page: number
  limit: number
}

async function fetchLogs(
  workspaceId: string,
  filters: LogFilters
): Promise<{ logs: WorkflowLog[]; hasMore: boolean }> {
  const queryParams = buildQueryParams(workspaceId, filters)
  const response = await fetch(`/api/logs?${queryParams}`)

  if (!response.ok) {
    throw new Error('Failed to fetch logs')
  }

  const apiData: LogsResponse = await response.json()

  return {
    logs: apiData.data || [],
    hasMore: apiData.data.length === filters.limit && apiData.page < apiData.totalPages,
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

function buildQueryParams(workspaceId: string, filters: LogFilters): string {
  const params = new URLSearchParams()

  params.set('workspaceId', workspaceId)
  params.set('limit', filters.limit.toString())
  params.set('offset', ((filters.page - 1) * filters.limit).toString())

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
    params.set('search', filters.searchQuery.trim())
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
  const setLogs = useFilterStore((state) => state.setLogs)
  const setHasMore = useFilterStore((state) => state.setHasMore)

  const query = useQuery({
    queryKey: logKeys.list(workspaceId, filters),
    queryFn: () => fetchLogs(workspaceId as string, filters),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0, // Always consider stale for real-time logs
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (query.data) {
      setLogs(query.data.logs)
      setHasMore(query.data.hasMore)
    }
  }, [query.data, setLogs, setHasMore])

  return query
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
