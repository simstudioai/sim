import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { deployWorkflowContract } from '@/lib/api/contracts/deployments'
import {
  type CreateScheduleBody,
  createScheduleContract,
  deleteScheduleContract,
  disableScheduleContract,
  getScheduleContract,
  listWorkspaceSchedulesContract,
  reactivateScheduleContract,
  type ScheduleLifecycle,
  type UpdateScheduleBody,
  updateScheduleContract,
  type WorkflowScheduleRow,
  type WorkspaceScheduleRow,
} from '@/lib/api/contracts/schedules'
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

export type ScheduleData = WorkflowScheduleRow
export type WorkspaceScheduleData = WorkspaceScheduleRow

export interface ScheduleInfo {
  id: string
  status: ScheduleData['status']
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
  try {
    const data = await requestJson(getScheduleContract, {
      query: { workflowId, blockId },
      signal,
    })
    return data.schedule || null
  } catch (error) {
    if (isApiClientError(error) && error.status === 404) return null
    throw error
  }
}

/**
 * Fetch all schedules for a workspace.
 */
export function useWorkspaceSchedules(workspaceId?: string) {
  return useQuery({
    queryKey: scheduleKeys.list(workspaceId ?? ''),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID required')

      const data = await requestJson(listWorkspaceSchedulesContract, {
        query: { workspaceId },
        signal,
      })
      return data.schedules || []
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
      await requestJson(reactivateScheduleContract, {
        params: { id: scheduleId },
        body: { action: 'reactivate' },
      })

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
      await requestJson(disableScheduleContract, {
        params: { id: scheduleId },
        body: { action: 'disable' },
      })

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
      await requestJson(deleteScheduleContract, {
        params: { id: scheduleId },
      })

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
    } & Omit<UpdateScheduleBody, 'action'>) => {
      await requestJson(updateScheduleContract, {
        params: { id: scheduleId },
        body: { action: 'update', ...updates },
      })

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
    }: CreateScheduleBody & {
      timezone: string
      lifecycle: ScheduleLifecycle
    }) => {
      return requestJson(createScheduleContract, {
        body: {
          workspaceId,
          title,
          prompt,
          cronExpression,
          timezone,
          lifecycle,
          maxRuns,
          startDate,
        },
      })
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
      await requestJson(deployWorkflowContract, {
        params: { id: workflowId },
      })

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
