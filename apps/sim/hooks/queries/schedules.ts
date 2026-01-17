import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { deploymentKeys } from '@/hooks/queries/deployments'

const logger = createLogger('ScheduleQueries')

export const scheduleKeys = {
  all: ['schedules'] as const,
  schedule: (workflowId: string, blockId: string) =>
    [...scheduleKeys.all, workflowId, blockId] as const,
}

export interface ScheduleData {
  id: string
  status: 'active' | 'disabled'
  cronExpression: string | null
  nextRunAt: string | null
  lastRanAt: string | null
  timezone: string
  failedCount: number
}

export interface ScheduleInfo {
  id: string
  status: 'active' | 'disabled'
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
async function fetchSchedule(workflowId: string, blockId: string): Promise<ScheduleData | null> {
  const params = new URLSearchParams({ workflowId, blockId })
  const response = await fetch(`/api/schedules?${params}`, {
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
 * Hook to fetch schedule data for a workflow block
 */
export function useScheduleQuery(
  workflowId: string | undefined,
  blockId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: scheduleKeys.schedule(workflowId ?? '', blockId ?? ''),
    queryFn: () => fetchSchedule(workflowId!, blockId!),
    enabled: !!workflowId && !!blockId && (options?.enabled ?? true),
    staleTime: 30 * 1000, // 30 seconds
    retry: false,
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
    }: {
      scheduleId: string
      workflowId: string
      blockId: string
    }) => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reactivate' }),
      })

      if (!response.ok) {
        throw new Error('Failed to reactivate schedule')
      }

      return { workflowId, blockId }
    },
    onSuccess: ({ workflowId, blockId }) => {
      logger.info('Schedule reactivated', { workflowId, blockId })
      queryClient.invalidateQueries({
        queryKey: scheduleKeys.schedule(workflowId, blockId),
      })
    },
    onError: (error) => {
      logger.error('Failed to reactivate schedule', { error })
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
