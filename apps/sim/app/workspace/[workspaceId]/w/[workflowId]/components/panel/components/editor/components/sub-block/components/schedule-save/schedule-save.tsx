import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { SaveStatusIndicator } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/save-status-indicator/save-status-indicator'
import { useAutoSave } from '@/hooks/use-auto-save'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useScheduleManagement } from '@/hooks/use-schedule-management'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('ScheduleSave')

interface ScheduleSaveProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

export function ScheduleSave({ blockId, isPreview = false, disabled = false }: ScheduleSaveProps) {
  const params = useParams()
  const workflowId = params.workflowId as string
  const [nextRunAt, setNextRunAt] = useState<Date | null>(null)
  const [lastRanAt, setLastRanAt] = useState<Date | null>(null)
  const [failedCount, setFailedCount] = useState<number>(0)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [savedCronExpression, setSavedCronExpression] = useState<string | null>(null)

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  const { scheduleId, saveConfig, isSaving } = useScheduleManagement({
    blockId,
    isPreview,
  })

  const scheduleType = useSubBlockStore((state) => state.getValue(blockId, 'scheduleType'))
  const scheduleMinutesInterval = useSubBlockStore((state) =>
    state.getValue(blockId, 'minutesInterval')
  )
  const scheduleHourlyMinute = useSubBlockStore((state) => state.getValue(blockId, 'hourlyMinute'))
  const scheduleDailyTime = useSubBlockStore((state) => state.getValue(blockId, 'dailyTime'))
  const scheduleWeeklyDay = useSubBlockStore((state) => state.getValue(blockId, 'weeklyDay'))
  const scheduleWeeklyTime = useSubBlockStore((state) => state.getValue(blockId, 'weeklyDayTime'))
  const scheduleMonthlyDay = useSubBlockStore((state) => state.getValue(blockId, 'monthlyDay'))
  const scheduleMonthlyTime = useSubBlockStore((state) => state.getValue(blockId, 'monthlyTime'))
  const scheduleCronExpression = useSubBlockStore((state) =>
    state.getValue(blockId, 'cronExpression')
  )
  const scheduleTimezone = useSubBlockStore((state) => state.getValue(blockId, 'timezone'))

  const validateRequiredFields = useCallback((): boolean => {
    if (!scheduleType) return false

    switch (scheduleType) {
      case 'minutes': {
        const minutesNum = Number(scheduleMinutesInterval)
        if (
          !scheduleMinutesInterval ||
          Number.isNaN(minutesNum) ||
          minutesNum < 1 ||
          minutesNum > 1440
        ) {
          return false
        }
        break
      }
      case 'hourly': {
        const hourlyNum = Number(scheduleHourlyMinute)
        if (
          scheduleHourlyMinute === null ||
          scheduleHourlyMinute === undefined ||
          scheduleHourlyMinute === '' ||
          Number.isNaN(hourlyNum) ||
          hourlyNum < 0 ||
          hourlyNum > 59
        ) {
          return false
        }
        break
      }
      case 'daily':
        if (!scheduleDailyTime) return false
        break
      case 'weekly':
        if (!scheduleWeeklyDay || !scheduleWeeklyTime) return false
        break
      case 'monthly': {
        const monthlyNum = Number(scheduleMonthlyDay)
        if (
          !scheduleMonthlyDay ||
          Number.isNaN(monthlyNum) ||
          monthlyNum < 1 ||
          monthlyNum > 31 ||
          !scheduleMonthlyTime
        ) {
          return false
        }
        break
      }
      case 'custom':
        if (!scheduleCronExpression) return false
        break
    }

    if (!scheduleTimezone && scheduleType !== 'minutes' && scheduleType !== 'hourly') {
      return false
    }

    return true
  }, [
    scheduleType,
    scheduleMinutesInterval,
    scheduleHourlyMinute,
    scheduleDailyTime,
    scheduleWeeklyDay,
    scheduleWeeklyTime,
    scheduleMonthlyDay,
    scheduleMonthlyTime,
    scheduleCronExpression,
    scheduleTimezone,
  ])

  const requiredSubBlockIds = useMemo(() => {
    return [
      'scheduleType',
      'minutesInterval',
      'hourlyMinute',
      'dailyTime',
      'weeklyDay',
      'weeklyDayTime',
      'monthlyDay',
      'monthlyTime',
      'cronExpression',
      'timezone',
    ]
  }, [])

  const subscribedSubBlockValues = useSubBlockStore(
    useCallback(
      (state) => {
        const values: Record<string, unknown> = {}
        requiredSubBlockIds.forEach((subBlockId) => {
          const value = state.getValue(blockId, subBlockId)
          if (value !== null && value !== undefined && value !== '') {
            values[subBlockId] = value
          }
        })
        return values
      },
      [blockId, requiredSubBlockIds]
    )
  )

  const configFingerprint = useMemo(() => {
    return JSON.stringify(subscribedSubBlockValues)
  }, [subscribedSubBlockValues])

  const handleSaveSuccess = useCallback(
    async (result: { success: boolean; nextRunAt?: string; cronExpression?: string }) => {
      const scheduleIdValue = useSubBlockStore.getState().getValue(blockId, 'scheduleId')
      collaborativeSetSubblockValue(blockId, 'scheduleId', scheduleIdValue)

      if (result.nextRunAt) {
        setNextRunAt(new Date(result.nextRunAt))
      }

      await fetchScheduleStatus()

      if (result.cronExpression) {
        setSavedCronExpression(result.cronExpression)
      }
    },
    [blockId, collaborativeSetSubblockValue]
  )

  const {
    saveStatus,
    errorMessage,
    retryCount,
    maxRetries,
    triggerSave,
    onConfigChange,
    markInitialLoadComplete,
  } = useAutoSave({
    disabled: isPreview || disabled,
    isExternallySaving: isSaving,
    validate: validateRequiredFields,
    onSave: saveConfig,
    onSaveSuccess: handleSaveSuccess,
    loggerName: 'ScheduleSave',
  })

  useEffect(() => {
    onConfigChange(configFingerprint)
  }, [configFingerprint, onConfigChange])

  useEffect(() => {
    if (!isLoadingStatus && scheduleId) {
      return markInitialLoadComplete(configFingerprint)
    }
    if (!scheduleId && !isLoadingStatus) {
      return markInitialLoadComplete(configFingerprint)
    }
  }, [isLoadingStatus, scheduleId, configFingerprint, markInitialLoadComplete])

  const fetchScheduleStatus = useCallback(async () => {
    if (!scheduleId || isPreview) return

    setIsLoadingStatus(true)
    try {
      const response = await fetch(
        `/api/schedules?workflowId=${workflowId}&blockId=${blockId}&mode=schedule`
      )
      if (response.ok) {
        const data = await response.json()
        if (data.schedule) {
          setNextRunAt(data.schedule.nextRunAt ? new Date(data.schedule.nextRunAt) : null)
          setLastRanAt(data.schedule.lastRanAt ? new Date(data.schedule.lastRanAt) : null)
          setFailedCount(data.schedule.failedCount || 0)
          setSavedCronExpression(data.schedule.cronExpression || null)
        }
      }
    } catch (error) {
      logger.error('Error fetching schedule status', { error })
    } finally {
      setIsLoadingStatus(false)
    }
  }, [workflowId, blockId, scheduleId, isPreview])

  useEffect(() => {
    if (scheduleId && !isPreview) {
      fetchScheduleStatus()
    }
  }, [scheduleId, isPreview, fetchScheduleStatus])

  if (isPreview) {
    return null
  }

  const hasScheduleInfo = scheduleId || isLoadingStatus || saveStatus === 'saving' || errorMessage

  if (!hasScheduleInfo) {
    return null
  }

  return (
    <div className='space-y-1 pb-4'>
      <SaveStatusIndicator
        status={saveStatus}
        errorMessage={errorMessage}
        savingText='Saving schedule...'
        loadingText='Loading schedule...'
        isLoading={isLoadingStatus}
        onRetry={triggerSave}
        retryDisabled={isSaving}
        retryCount={retryCount}
        maxRetries={maxRetries}
      />

      {/* Schedule status info */}
      {scheduleId && !isLoadingStatus && saveStatus !== 'saving' && (
        <>
          {failedCount > 0 && (
            <p className='text-destructive text-sm'>
              {failedCount} failed run{failedCount !== 1 ? 's' : ''}
            </p>
          )}

          {savedCronExpression && (
            <p className='text-muted-foreground text-sm'>
              Runs{' '}
              {parseCronToHumanReadable(
                savedCronExpression,
                scheduleTimezone || 'UTC'
              ).toLowerCase()}
            </p>
          )}

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
        </>
      )}
    </div>
  )
}
