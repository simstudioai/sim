import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import type { ScheduleInfo } from '../types'

const logger = createLogger('useScheduleInfo')

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
  /** Function to disable an active schedule */
  disableSchedule: (scheduleId: string) => Promise<void>
}

/**
 * Custom hook for managing schedule information
 *
 * @param blockId - The ID of the block
 * @param blockType - The type of the block
 * @param workflowId - The current workflow ID
 * @returns Schedule information state and operations
 */
export function useScheduleInfo(
  blockId: string,
  blockType: string,
  workflowId: string
): UseScheduleInfoReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [scheduleInfo, setScheduleInfo] = useState<ScheduleInfo | null>(null)

  const fetchScheduleInfo = useCallback(
    async (wfId: string) => {
      if (!wfId) return

      try {
        setIsLoading(true)

        const params = new URLSearchParams({
          workflowId: wfId,
          mode: 'schedule',
          blockId,
        })

        const response = await fetch(`/api/schedules?${params}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })

        if (!response.ok) {
          setScheduleInfo(null)
          return
        }

        const data = await response.json()

        if (!data.schedule) {
          setScheduleInfo(null)
          return
        }

        const schedule = data.schedule
        const scheduleTimezone = schedule.timezone || 'UTC'

        setScheduleInfo({
          scheduleTiming: schedule.cronExpression
            ? parseCronToHumanReadable(schedule.cronExpression, scheduleTimezone)
            : 'Unknown schedule',
          nextRunAt: schedule.nextRunAt,
          lastRanAt: schedule.lastRanAt,
          timezone: scheduleTimezone,
          status: schedule.status,
          isDisabled: schedule.status === 'disabled',
          id: schedule.id,
        })
      } catch (error) {
        logger.error('Error fetching schedule info:', error)
        setScheduleInfo(null)
      } finally {
        setIsLoading(false)
      }
    },
    [blockId]
  )

  const reactivateSchedule = useCallback(
    async (scheduleId: string) => {
      try {
        const response = await fetch(`/api/schedules/${scheduleId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'reactivate' }),
        })

        if (response.ok && workflowId) {
          fetchScheduleInfo(workflowId)
        } else {
          logger.error('Failed to reactivate schedule')
        }
      } catch (error) {
        logger.error('Error reactivating schedule:', error)
      }
    },
    [workflowId, fetchScheduleInfo]
  )

  const disableSchedule = useCallback(
    async (scheduleId: string) => {
      try {
        const response = await fetch(`/api/schedules/${scheduleId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'disable' }),
        })

        if (response.ok && workflowId) {
          fetchScheduleInfo(workflowId)
        } else {
          logger.error('Failed to disable schedule')
        }
      } catch (error) {
        logger.error('Error disabling schedule:', error)
      }
    },
    [workflowId, fetchScheduleInfo]
  )

  useEffect(() => {
    if (blockType === 'schedule' && workflowId) {
      fetchScheduleInfo(workflowId)
    } else {
      setScheduleInfo(null)
      setIsLoading(false)
    }

    const handleScheduleUpdate = (event: CustomEvent) => {
      if (event.detail?.workflowId === workflowId && event.detail?.blockId === blockId) {
        logger.debug('Schedule update event received, refetching schedule info')
        if (blockType === 'schedule') {
          fetchScheduleInfo(workflowId)
        }
      }
    }

    window.addEventListener('schedule-updated', handleScheduleUpdate as EventListener)

    return () => {
      setIsLoading(false)
      window.removeEventListener('schedule-updated', handleScheduleUpdate as EventListener)
    }
  }, [blockType, workflowId, blockId, fetchScheduleInfo])

  return {
    scheduleInfo,
    isLoading,
    reactivateSchedule,
    disableSchedule,
  }
}
