import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { deployWorkflowContract } from '@/lib/api/contracts/deployments'
import {
  type CreateScheduleBody,
  createScheduleContract,
  deleteScheduleContract,
  disableScheduleContract,
  excludeOccurrenceContract,
  getScheduleByIdContract,
  getScheduleContract,
  listWorkspaceSchedulesContract,
  reactivateScheduleContract,
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
  byId: (scheduleId: string) => [...scheduleKeys.details(), scheduleId] as const,
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
 * Fetch a single schedule (job) by id. Used by the mothership resource viewer so
 * opening a scheduled-task artifact does a lightweight by-id read instead of the
 * whole-workspace `useWorkspaceSchedules` fetch (which contended with the chat
 * stream connection and stalled start/resume).
 */
export function useScheduleById(scheduleId?: string) {
  return useQuery({
    queryKey: scheduleKeys.byId(scheduleId ?? ''),
    queryFn: async ({ signal }) => {
      if (!scheduleId) throw new Error('Schedule ID required')

      const data = await requestJson(getScheduleByIdContract, {
        params: { id: scheduleId },
        signal,
      })
      return data.schedule
    },
    enabled: Boolean(scheduleId),
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
    onSuccess: ({ workflowId, blockId }) => {
      logger.info('Schedule reactivated', { workflowId, blockId })
    },
    onError: (error) => {
      logger.error('Failed to reactivate schedule', { error })
    },
    onSettled: async (data) => {
      if (!data) return
      const { workflowId, blockId, workspaceId } = data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.schedule(workflowId, blockId) }),
        workspaceId
          ? queryClient.invalidateQueries({ queryKey: scheduleKeys.list(workspaceId) })
          : Promise.resolve(),
      ])
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
    onSuccess: () => {
      toast.success('Task paused')
    },
    onError: (error) => {
      logger.error('Failed to disable schedule', { error })
      toast.error("Couldn't pause task", { description: getErrorMessage(error) })
    },
    onSettled: async (data) => {
      if (!data) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.list(data.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: scheduleKeys.details() }),
      ])
    },
  })
}

/**
 * Mutation to resume (reactivate) a paused standalone job schedule. Keyed by
 * `workspaceId` so it invalidates the workspace list; the workflow-block variant
 * {@link useReactivateSchedule} keys by `workflowId`/`blockId` instead. Resuming
 * recomputes `nextRunAt` from the schedule's cron, so it applies to recurring
 * tasks only — one-time tasks carry no cadence to resume.
 */
export function useResumeSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      scheduleId,
      workspaceId,
    }: {
      scheduleId: string
      workspaceId: string
    }) => {
      await requestJson(reactivateScheduleContract, {
        params: { id: scheduleId },
        body: { action: 'reactivate' },
      })

      return { workspaceId }
    },
    onSuccess: () => {
      toast.success('Task resumed')
    },
    onError: (error) => {
      logger.error('Failed to resume schedule', { error })
      toast.error("Couldn't resume task", { description: getErrorMessage(error) })
    },
    onSettled: async (data) => {
      if (!data) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.list(data.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: scheduleKeys.details() }),
      ])
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
    onSuccess: () => {
      toast.success('Task deleted')
    },
    onError: (error) => {
      logger.error('Failed to delete schedule', { error })
      toast.error("Couldn't delete task", { description: getErrorMessage(error) })
    },
    onSettled: async (data) => {
      if (!data) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.list(data.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: scheduleKeys.details() }),
      ])
    },
  })
}

/**
 * Mutation to delete a single occurrence of a recurring task (gcal "this
 * event"). The whole series is deleted via {@link useDeleteSchedule} instead.
 */
export function useExcludeOccurrence() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      scheduleId,
      occurrence,
      workspaceId,
    }: {
      scheduleId: string
      occurrence: string
      workspaceId: string
    }) => {
      await requestJson(excludeOccurrenceContract, {
        params: { id: scheduleId },
        body: { action: 'exclude_occurrence', occurrence },
      })

      return { workspaceId }
    },
    onSuccess: () => {
      toast.success('Occurrence removed')
    },
    onError: (error) => {
      logger.error('Failed to delete occurrence', { error })
      toast.error("Couldn't remove occurrence", { description: getErrorMessage(error) })
    },
    onSettled: async (data) => {
      if (!data) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.list(data.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: scheduleKeys.details() }),
      ])
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
    onSuccess: () => {
      toast.success('Task updated')
    },
    onError: (error) => {
      logger.error('Failed to update schedule', { error })
      toast.error("Couldn't update task", { description: getErrorMessage(error) })
    },
    onSettled: async (data) => {
      if (!data) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.list(data.workspaceId) }),
        queryClient.invalidateQueries({ queryKey: scheduleKeys.details() }),
      ])
    },
  })
}

/**
 * Mutation to create a standalone scheduled job
 */
export function useCreateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: CreateScheduleBody) => requestJson(createScheduleContract, { body }),
    onSuccess: () => {
      toast.success('Task scheduled')
    },
    onError: (error) => {
      logger.error('Failed to create schedule', { error })
      toast.error("Couldn't schedule task", { description: getErrorMessage(error) })
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: scheduleKeys.list(variables.workspaceId) }),
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
    },
    onError: (error) => {
      logger.error('Failed to redeploy workflow', { error })
    },
    onSettled: async (data) => {
      if (!data) return
      const { workflowId, blockId } = data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.schedule(workflowId, blockId) }),
        queryClient.invalidateQueries({ queryKey: deploymentKeys.info(workflowId) }),
        queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(workflowId) }),
      ])
    },
  })
}
