import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('ScheduleStatus')

interface ScheduleInfoProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

/**
 * Schedule status display component.
 * Shows the current schedule status, next run time, and last run time.
 * Schedule creation/deletion is handled during workflow deploy/undeploy.
 */
export function ScheduleInfo({ blockId, isPreview = false }: ScheduleInfoProps) {
  const params = useParams()
  const workflowId = params.workflowId as string
  const [scheduleStatus, setScheduleStatus] = useState<'active' | 'disabled' | null>(null)
  const [nextRunAt, setNextRunAt] = useState<Date | null>(null)
  const [lastRanAt, setLastRanAt] = useState<Date | null>(null)
  const [failedCount, setFailedCount] = useState<number>(0)
  const [isLoadingStatus, setIsLoadingStatus] = useState(true)
  const [savedCronExpression, setSavedCronExpression] = useState<string | null>(null)
  const [isRedeploying, setIsRedeploying] = useState(false)
  const [hasSchedule, setHasSchedule] = useState(false)

  const scheduleTimezone = useSubBlockStore((state) => state.getValue(blockId, 'timezone'))

  const fetchScheduleStatus = useCallback(async () => {
    if (isPreview) return

    setIsLoadingStatus(true)
    try {
      const response = await fetch(`/api/schedules?workflowId=${workflowId}&blockId=${blockId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.schedule) {
          setHasSchedule(true)
          setScheduleStatus(data.schedule.status)
          setNextRunAt(data.schedule.nextRunAt ? new Date(data.schedule.nextRunAt) : null)
          setLastRanAt(data.schedule.lastRanAt ? new Date(data.schedule.lastRanAt) : null)
          setFailedCount(data.schedule.failedCount || 0)
          setSavedCronExpression(data.schedule.cronExpression || null)
        } else {
          // No schedule exists (workflow not deployed or no schedule block)
          setHasSchedule(false)
          setScheduleStatus(null)
          setNextRunAt(null)
          setLastRanAt(null)
          setFailedCount(0)
          setSavedCronExpression(null)
        }
      }
    } catch (error) {
      logger.error('Error fetching schedule status', { error })
    } finally {
      setIsLoadingStatus(false)
    }
  }, [workflowId, blockId, isPreview])

  useEffect(() => {
    if (!isPreview) {
      fetchScheduleStatus()
    }
  }, [isPreview, fetchScheduleStatus])

  /**
   * Handles redeploying the workflow when schedule is disabled due to failures.
   * Redeploying will recreate the schedule with reset failure count.
   */
  const handleRedeploy = async () => {
    if (isPreview || isRedeploying) return

    setIsRedeploying(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deployChatEnabled: false }),
      })

      if (response.ok) {
        // Refresh schedule status after redeploy
        await fetchScheduleStatus()
        logger.info('Workflow redeployed successfully to reset schedule', { workflowId, blockId })
      } else {
        const errorData = await response.json()
        logger.error('Failed to redeploy workflow', { error: errorData.error })
      }
    } catch (error) {
      logger.error('Error redeploying workflow', { error })
    } finally {
      setIsRedeploying(false)
    }
  }

  // Don't render anything if there's no deployed schedule
  if (!hasSchedule && !isLoadingStatus) {
    return null
  }

  return (
    <div className='mt-2'>
      {isLoadingStatus ? (
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          Loading schedule status...
        </div>
      ) : (
        <div className='space-y-1'>
          {/* Failure badge with redeploy action */}
          {failedCount >= 10 && scheduleStatus === 'disabled' && (
            <button
              type='button'
              onClick={handleRedeploy}
              disabled={isRedeploying}
              className='flex w-full cursor-pointer items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-left text-destructive text-sm transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isRedeploying ? (
                <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
              ) : (
                <AlertTriangle className='h-4 w-4 flex-shrink-0' />
              )}
              <span>
                {isRedeploying
                  ? 'Redeploying...'
                  : `Schedule disabled after ${failedCount} failures - Click to redeploy`}
              </span>
            </button>
          )}

          {/* Show warning for failed runs under threshold */}
          {failedCount > 0 && failedCount < 10 && (
            <div className='flex items-center gap-2'>
              <span className='text-destructive text-sm'>
                ⚠️ {failedCount} failed run{failedCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Cron expression human-readable description */}
          {savedCronExpression && (
            <p className='text-muted-foreground text-sm'>
              Runs{' '}
              {parseCronToHumanReadable(
                savedCronExpression,
                scheduleTimezone || 'UTC'
              ).toLowerCase()}
            </p>
          )}

          {/* Next run time */}
          {nextRunAt && (
            <p className='text-sm'>
              <span className='font-medium'>Next run:</span>{' '}
              {nextRunAt.toLocaleString('en-US', {
                timeZone: scheduleTimezone || 'UTC',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}{' '}
              {scheduleTimezone || 'UTC'}
            </p>
          )}

          {/* Last ran time */}
          {lastRanAt && (
            <p className='text-muted-foreground text-sm'>
              <span className='font-medium'>Last ran:</span>{' '}
              {lastRanAt.toLocaleString('en-US', {
                timeZone: scheduleTimezone || 'UTC',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}{' '}
              {scheduleTimezone || 'UTC'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
