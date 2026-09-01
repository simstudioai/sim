import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { deployWorkflowContract } from '@/lib/api/contracts/deployments'
import {
  getScheduleContract,
  listWorkspaceSchedulesContract,
  reactivateScheduleContract,
  type WorkflowScheduleRow,
  type WorkspaceScheduleRow,
} from '@/lib/api/contracts/schedules'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { deploymentKeys } from '@/hooks/queries/deployments'

const logger = createLogger('ScheduleQueries')

export const SCHEDULE_LIST_STALE_TIME = 30 * 1000
export const SCHEDULE_DETAIL_STALE_TIME = 30 * 1000
export const SCHEDULE_BLOCK_STALE_TIME = 30 * 1000

export const scheduleKeys = {
  all: ['schedules'] as const,
  lists: () => [...scheduleKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...scheduleKeys.lists(), workspaceId] as const,
  details: () => [...scheduleKeys.all, 'detail'] as const,
  schedule: (workflowId: string, blockId: string) =>
    [...scheduleKeys.details(), workflowId, blockId] as const,
  /**
   * By-id reads sit under their own segment rather than directly under `details()`:
   * a bare `[...details(), scheduleId]` is a prefix of `schedule(scheduleId, blockId)`,
   * so the two addressings of the same schedule would alias in the cache.
   */
  byIds: () => [...scheduleKeys.details(), 'by-id'] as const,
  byId: (scheduleId: string) => [...scheduleKeys.byIds(), scheduleId] as const,
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
export function useWorkspaceSchedules(workspaceId?: string, options?: { enabled?: boolean }) {
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
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: SCHEDULE_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
    // Pinned off (not inheriting the QueryClient default, which is on in the
    // desktop app): a background refetch regenerates occurrence ids, so any
    // consumer holding one across a refetch would lose it mid-edit.
    refetchOnWindowFocus: false,
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
    staleTime: SCHEDULE_BLOCK_STALE_TIME,
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

      return { scheduleId, workflowId, blockId, workspaceId }
    },
    onSuccess: ({ workflowId, blockId }) => {
      logger.info('Schedule reactivated', { workflowId, blockId })
    },
    onError: (error) => {
      logger.error('Failed to reactivate schedule', { error })
    },
    onSettled: async (data) => {
      if (!data) return
      const { scheduleId, workflowId, blockId, workspaceId } = data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.schedule(workflowId, blockId) }),
        queryClient.invalidateQueries({ queryKey: scheduleKeys.byId(scheduleId) }),
        workspaceId
          ? queryClient.invalidateQueries({ queryKey: scheduleKeys.list(workspaceId) })
          : Promise.resolve(),
      ])
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
    },
    onError: (error) => {
      logger.error('Failed to redeploy workflow', { error })
    },
    onSettled: async (data) => {
      if (!data) return
      const { workflowId, blockId } = data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scheduleKeys.schedule(workflowId, blockId) }),
        /** A redeploy recreates the schedule; the id-keyed reads are a separate subtree. */
        queryClient.invalidateQueries({ queryKey: scheduleKeys.byIds() }),
        queryClient.invalidateQueries({ queryKey: deploymentKeys.info(workflowId) }),
        queryClient.invalidateQueries({ queryKey: deploymentKeys.versions(workflowId) }),
      ])
    },
  })
}
