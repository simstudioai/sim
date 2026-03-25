import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { deploymentKeys } from '@/hooks/queries/deployments'

const logger = createLogger('ScheduleQueries')

export const scheduleKeys = {
  all: ['schedules'] as const,
  lists: () => [...scheduleKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...scheduleKeys.lists(), workspaceId] as const,
  details: () => [...scheduleKeys.all, 'detail'] as const,
  schedule: (workflowId: string, blockId: string) =>
    [...scheduleKeys.details(), workflowId, blockId] as const,
}

export interface ScheduleData {
  id: string
  status: 'active' | 'disabled' | 'completed'
  cronExpression: string | null
  nextRunAt: string | null
  lastRanAt: string | null
  timezone: string
  failedCount: number
}

export interface WorkspaceScheduleData extends ScheduleData {
  workflowId: string | null
  workflowName: string | null
  workflowColor: string | null
  sourceType: 'workflow' | 'job'
  jobTitle: string | null
  prompt: string | null
  sourceTaskName: string | null
  lifecycle: string | null
  runCount: number | null
  maxRuns: number | null
}

export interface ScheduleInfo {
  id: string
  status: 'active' | 'disabled' | 'completed'
  scheduleTiming: string
  nextRunAt: string | null
  lastRanAt: string | null
  timezone: string
  isDisabled: boolean
  failedCount: number
}

/**
 * Fetches schedule data for a specific workflow block
 */
async function fetchSchedule(
  workflowId: string,
  blockId: string,
  signal?: AbortSignal
): Promise<ScheduleData | null> {
  const params = new URLSearchParams({ workflowId, blockId })
  const response = await fetch(`/api/schedules?${params}`, {
    signal,
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  return data.schedule || null
}

/**
 * Fetch all schedules for a workspace.
 */
export function useWorkspaceSchedules(workspaceId?: string) {
  return useQuery({
    queryKey: scheduleKeys.list(workspaceId ?? ''),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID required')

      const res = await fetch(`/api/schedules?workspaceId=${encodeURIComponent(workspaceId)}`, {
        signal,
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to fetch schedules')
      }

      const data = await res.json()
      return (data.schedules || []) as WorkspaceScheduleData[]
    },
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Hook to fetch schedule data for a workflow block
 */
export function useScheduleQuery(
  workflowId: string | undefined,
  blockId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: scheduleKeys.schedule(workflowId ?? '', blockId ?? ''),
    queryFn: ({ signal }) => fetchSchedule(workflowId!, blockId!, signal),
    enabled: !!workflowId && !!blockId && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
    retry: false,
    placeholderData: keepPreviousData,
  })
}

/**
 * Hook to get processed schedule info with human-readable timing
 */
export function useScheduleInfo(
  workflowId: string | undefined,
  blockId: string | undefined,
  blockType: string,
  options?: { timezone?: string }
): {
  scheduleInfo: ScheduleInfo | null
  isLoading: boolean
  refetch: () => void
} {
  const isScheduleBlock = blockType === 'schedule'

  const { data, isLoading, refetch } = useScheduleQuery(workflowId, blockId, {
    enabled: isScheduleBlock,
  })

  if (!data) {
    return { scheduleInfo: null, isLoading, refetch }
  }

  const timezone = options?.timezone || data.timezone || 'UTC'
  const scheduleTiming = data.cronExpression
    ? parseCronToHumanReadable(data.cronExpression, timezone)
    : 'Unknown schedule'

  return {
    scheduleInfo: {
      id: data.id,
      status: data.status,
      scheduleTiming,
      nextRunAt: data.nextRunAt,
      lastRanAt: data.lastRanAt,
      timezone,
      isDisabled: data.status === 'disabled',
      failedCount: data.failedCount || 0,
    },
    isLoading,
    refetch,
  }
}

/**
 * Mutation to reactivate a disabled schedule
 */
export function useReactivateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      scheduleId,
      workflowId,
      blockId,
      workspaceId,
    }: {
      scheduleId: string
      workflowId: string
      blockId: string
      workspaceId?: string
    }) => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reactivate' }),
      })

      if (!response.ok) {
        throw new Error('Failed to reactivate schedule')
      }

      return { workflowId, blockId, workspaceId }
    },
    onSuccess: ({ workflowId, blockId, workspaceId }) => {
      logger.info('Schedule reactivated', { workflowId, blockId })
      queryClient.invalidateQueries({
        queryKey: scheduleKeys.schedule(workflowId, blockId),
      })
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: scheduleKeys.list(workspaceId) })
      }
    },
    onError: (error) => {
      logger.error('Failed to reactivate schedule', { error })
    },
  })
}

/**
 * Mutation to disable an active schedule or job
 */
export function useDisableSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      scheduleId,
      workspaceId,
    }: {
      scheduleId: string
      workspaceId: string
    }) => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disable' }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to disable schedule')
      }

      return { workspaceId }
    },
    onSuccess: ({ workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.list(workspaceId) })
      queryClient.invalidateQueries({ queryKey: scheduleKeys.details() })
    },
    onError: (error) => {
      logger.error('Failed to disable schedule', { error })
    },
  })
}

/**
 * Mutation to delete a schedule or job
 */
export function useDeleteSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      scheduleId,
      workspaceId,
    }: {
      scheduleId: string
      workspaceId: string
    }) => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete schedule')
      }

      return { workspaceId }
    },
    onSuccess: ({ workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.list(workspaceId) })
      queryClient.invalidateQueries({ queryKey: scheduleKeys.details() })
    },
    onError: (error) => {
      logger.error('Failed to delete schedule', { error })
    },
  })
}

/**
 * Mutation to update fields on a standalone job schedule
 */
export function useUpdateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      scheduleId,
      workspaceId,
      ...updates
    }: {
      scheduleId: string
      workspaceId: string
      title?: string
      prompt?: string
      cronExpression?: string
      timezone?: string
      lifecycle?: 'persistent' | 'until_complete'
      maxRuns?: number | null
    }) => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', ...updates }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update schedule')
      }

      return { workspaceId }
    },
    onSuccess: ({ workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.list(workspaceId) })
      queryClient.invalidateQueries({ queryKey: scheduleKeys.details() })
    },
    onError: (error) => {
      logger.error('Failed to update schedule', { error })
    },
  })
}

/**
 * Mutation to create a standalone scheduled job
 */
export function useCreateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      title,
      prompt,
      cronExpression,
      timezone,
      lifecycle,
      maxRuns,
      startDate,
    }: {
      workspaceId: string
      title: string
      prompt: string
      cronExpression: string
      timezone: string
      lifecycle: 'persistent' | 'until_complete'
      maxRuns?: number
      startDate?: string
    }) => {
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title,
          prompt,
          cronExpression,
          timezone,
          lifecycle,
          maxRuns,
          startDate,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create schedule')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.list(variables.workspaceId) })
    },
    onError: (error) => {
      logger.error('Failed to create schedule', { error })
    },
  })
}

/**
 * Mutation to redeploy a workflow (which recreates the schedule)
 */
export function useRedeployWorkflowSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId, blockId }: { workflowId: string; blockId: string }) => {
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deployChatEnabled: false }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to redeploy workflow')
      }

      return { workflowId, blockId }
    },
    onSuccess: ({ workflowId, blockId }) => {
      logger.info('Workflow redeployed for schedule reset', { workflowId, blockId })
      queryClient.invalidateQueries({
        queryKey: scheduleKeys.schedule(workflowId, blockId),
      })
      // Also invalidate deployment queries since we redeployed
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to redeploy workflow', { error })
    },
  })
}
