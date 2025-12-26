import { useCallback } from 'react'
import {
  useReactivateSchedule,
  useScheduleInfo as useScheduleInfoQuery,
} from '@/hooks/queries/schedules'
import type { ScheduleInfo } from '../types'

/**
 * Return type for the useScheduleInfo hook
 */
export interface UseScheduleInfoReturn {
  /** The schedule configuration and timing information */
  scheduleInfo: ScheduleInfo | null
  /** Whether the schedule information is currently being fetched */
  isLoading: boolean
  /** Function to reactivate a disabled schedule */
  reactivateSchedule: (scheduleId: string) => Promise<void>
}

/**
 * Custom hook for fetching schedule information using TanStack Query
 *
 * @param blockId - The ID of the block
 * @param blockType - The type of the block
 * @param workflowId - The current workflow ID
 * @returns Schedule information state and reactivate function
 */
export function useScheduleInfo(
  blockId: string,
  blockType: string,
  workflowId: string
): UseScheduleInfoReturn {
  const { scheduleInfo: queryScheduleInfo, isLoading } = useScheduleInfoQuery(
    workflowId,
    blockId,
    blockType
  )

  const reactivateMutation = useReactivateSchedule()

  const reactivateSchedule = useCallback(
    async (scheduleId: string) => {
      await reactivateMutation.mutateAsync({
        scheduleId,
        workflowId,
        blockId,
      })
    },
    [reactivateMutation, workflowId, blockId]
  )

  const scheduleInfo: ScheduleInfo | null = queryScheduleInfo
    ? {
        scheduleTiming: queryScheduleInfo.scheduleTiming,
        nextRunAt: queryScheduleInfo.nextRunAt,
        lastRanAt: queryScheduleInfo.lastRanAt,
        timezone: queryScheduleInfo.timezone,
        status: queryScheduleInfo.status,
        isDisabled: queryScheduleInfo.isDisabled,
        failedCount: queryScheduleInfo.failedCount,
        id: queryScheduleInfo.id,
      }
    : null

  return {
    scheduleInfo,
    isLoading,
    reactivateSchedule,
  }
}
