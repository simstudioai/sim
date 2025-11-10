import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn/components'
import { Trash } from '@/components/emcn/icons/trash'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { cn } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useScheduleManagement } from '@/hooks/use-schedule-management'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('ScheduleSave')

interface ScheduleSaveProps {
  blockId: string
  isPreview?: boolean
  disabled?: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function ScheduleSave({ blockId, isPreview = false, disabled = false }: ScheduleSaveProps) {
  const params = useParams()
  const workflowId = params.workflowId as string
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting'>('idle')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [scheduleStatus, setScheduleStatus] = useState<'active' | 'disabled' | null>(null)
  const [nextRunAt, setNextRunAt] = useState<Date | null>(null)
  const [lastRanAt, setLastRanAt] = useState<Date | null>(null)
  const [failedCount, setFailedCount] = useState<number>(0)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [savedCronExpression, setSavedCronExpression] = useState<string | null>(null)

  const { collaborativeSetSubblockValue } = useCollaborativeWorkflow()

  const { scheduleId, saveConfig, deleteConfig, isSaving } = useScheduleManagement({
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

  const validateRequiredFields = useCallback((): { valid: boolean; missingFields: string[] } => {
    const missingFields: string[] = []

    if (!scheduleType) {
      missingFields.push('Frequency')
      return { valid: false, missingFields }
    }

    switch (scheduleType) {
      case 'minutes': {
        const minutesNum = Number(scheduleMinutesInterval)
        if (
          !scheduleMinutesInterval ||
          Number.isNaN(minutesNum) ||
          minutesNum < 1 ||
          minutesNum > 1440
        ) {
          missingFields.push('Minutes Interval (must be 1-1440)')
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
          missingFields.push('Minute (must be 0-59)')
        }
        break
      }
      case 'daily':
        if (!scheduleDailyTime) {
          missingFields.push('Time')
        }
        break
      case 'weekly':
        if (!scheduleWeeklyDay) {
          missingFields.push('Day of Week')
        }
        if (!scheduleWeeklyTime) {
          missingFields.push('Time')
        }
        break
      case 'monthly': {
        const monthlyNum = Number(scheduleMonthlyDay)
        if (!scheduleMonthlyDay || Number.isNaN(monthlyNum) || monthlyNum < 1 || monthlyNum > 31) {
          missingFields.push('Day of Month (must be 1-31)')
        }
        if (!scheduleMonthlyTime) {
          missingFields.push('Time')
        }
        break
      }
      case 'custom':
        if (!scheduleCronExpression) {
          missingFields.push('Cron Expression')
        }
        break
    }

    if (!scheduleTimezone && scheduleType !== 'minutes' && scheduleType !== 'hourly') {
      missingFields.push('Timezone')
    }

    return {
      valid: missingFields.length === 0,
      missingFields,
    }
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
        const values: Record<string, any> = {}
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

  const previousValuesRef = useRef<Record<string, any>>({})
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (saveStatus !== 'error') {
      previousValuesRef.current = subscribedSubBlockValues
      return
    }

    const hasChanges = Object.keys(subscribedSubBlockValues).some(
      (key) =>
        previousValuesRef.current[key] !== (subscribedSubBlockValues as Record<string, any>)[key]
    )

    if (!hasChanges) {
      return
    }

    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current)
    }

    validationTimeoutRef.current = setTimeout(() => {
      const validation = validateRequiredFields()

      if (validation.valid) {
        setErrorMessage(null)
        setSaveStatus('idle')
        logger.debug('Error cleared after validation passed', { blockId })
      } else {
        setErrorMessage(`Missing required fields: ${validation.missingFields.join(', ')}`)
        logger.debug('Error message updated', {
          blockId,
          missingFields: validation.missingFields,
        })
      }

      previousValuesRef.current = subscribedSubBlockValues
    }, 300)

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [blockId, subscribedSubBlockValues, saveStatus, validateRequiredFields])

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
          setScheduleStatus(data.schedule.status)
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

  const handleSave = async () => {
    if (isPreview || disabled) return

    setSaveStatus('saving')
    setErrorMessage(null)

    try {
      const validation = validateRequiredFields()
      if (!validation.valid) {
        setErrorMessage(`Missing required fields: ${validation.missingFields.join(', ')}`)
        setSaveStatus('error')
        return
      }

      const result = await saveConfig()
      if (!result.success) {
        throw new Error('Save config returned false')
      }

      setSaveStatus('saved')
      setErrorMessage(null)

      const scheduleIdValue = useSubBlockStore.getState().getValue(blockId, 'scheduleId')
      collaborativeSetSubblockValue(blockId, 'scheduleId', scheduleIdValue)

      if (result.nextRunAt) {
        setNextRunAt(new Date(result.nextRunAt))
        setScheduleStatus('active')
      }

      // Fetch additional status info, then apply cron from save result to prevent stale data
      await fetchScheduleStatus()

      if (result.cronExpression) {
        setSavedCronExpression(result.cronExpression)
      }

      setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)

      logger.info('Schedule configuration saved successfully', {
        blockId,
        hasScheduleId: !!scheduleId,
      })
    } catch (error: any) {
      setSaveStatus('error')
      setErrorMessage(error.message || 'An error occurred while saving.')
      logger.error('Error saving schedule config', { error })
    }
  }

  const handleDelete = async () => {
    if (isPreview || disabled) return

    setShowDeleteDialog(false)
    setDeleteStatus('deleting')

    try {
      const success = await deleteConfig()
      if (!success) {
        throw new Error('Failed to delete schedule')
      }

      setScheduleStatus(null)
      setNextRunAt(null)
      setLastRanAt(null)
      setFailedCount(0)

      collaborativeSetSubblockValue(blockId, 'scheduleId', null)

      logger.info('Schedule deleted successfully', { blockId })
    } catch (error: any) {
      setErrorMessage(error.message || 'An error occurred while deleting.')
      logger.error('Error deleting schedule', { error })
    } finally {
      setDeleteStatus('idle')
    }
  }

  const handleDeleteConfirm = () => {
    handleDelete()
  }

  const handleToggleStatus = async () => {
    if (!scheduleId || isPreview || disabled) return

    try {
      const action = scheduleStatus === 'active' ? 'disable' : 'reactivate'
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (response.ok) {
        await fetchScheduleStatus()
        logger.info(`Schedule ${action}d successfully`, { scheduleId })
      } else {
        throw new Error(`Failed to ${action} schedule`)
      }
    } catch (error: any) {
      setErrorMessage(
        error.message ||
          `An error occurred while ${scheduleStatus === 'active' ? 'disabling' : 'reactivating'} the schedule.`
      )
      logger.error('Error toggling schedule status', { error })
    }
  }

  return (
    <div className='mt-2'>
      <div className='flex gap-2'>
        <Button
          variant='default'
          onClick={handleSave}
          disabled={disabled || isPreview || isSaving || saveStatus === 'saving' || isLoadingStatus}
          className={cn(
            'h-9 flex-1 rounded-[8px] transition-all duration-200',
            saveStatus === 'saved' && 'bg-green-600 hover:bg-green-700',
            saveStatus === 'error' && 'bg-red-600 hover:bg-red-700'
          )}
        >
          {saveStatus === 'saving' && (
            <>
              <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
              Saving...
            </>
          )}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'idle' && (scheduleId ? 'Update Schedule' : 'Save Schedule')}
          {saveStatus === 'error' && 'Error'}
        </Button>

        {scheduleId && (
          <Button
            variant='default'
            onClick={() => setShowDeleteDialog(true)}
            disabled={disabled || isPreview || deleteStatus === 'deleting' || isSaving}
            className='h-9 rounded-[8px] px-3'
          >
            {deleteStatus === 'deleting' ? (
              <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
            ) : (
              <Trash className='h-[14px] w-[14px]' />
            )}
          </Button>
        )}
      </div>

      {errorMessage && (
        <Alert variant='destructive' className='mt-2'>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {scheduleId && (scheduleStatus || isLoadingStatus || nextRunAt) && (
        <div className='mt-2 space-y-1'>
          {isLoadingStatus ? (
            <div className='flex items-center gap-2 text-muted-foreground text-sm'>
              <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
              Loading schedule status...
            </div>
          ) : (
            <>
              {failedCount > 0 && (
                <div className='flex items-center gap-2'>
                  <span className='text-destructive text-sm'>
                    ⚠️ {failedCount} failed run{failedCount !== 1 ? 's' : ''}
                  </span>
                </div>
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
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule configuration? This will stop the
              workflow from running automatically. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
