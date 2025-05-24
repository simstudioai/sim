import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Trash2, X } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useSubBlockValue } from '../../../hooks/use-sub-block-value'
import { TimeInput } from '../../time-input'
import { UnsavedChangesDialog } from '../../webhook/components/ui/confirmation'

const logger = createLogger('ScheduleModal')

interface ScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  workflowId: string
  blockId: string
  onSave: () => Promise<boolean>
  onDelete?: () => Promise<boolean>
  scheduleId?: string | null
}

export function ScheduleModal({
  isOpen,
  onClose,
  workflowId,
  blockId,
  onSave,
  onDelete,
  scheduleId,
}: ScheduleModalProps) {
  // States for schedule configuration
  const [scheduleType, setScheduleType] = useSubBlockValue(blockId, 'scheduleType')
  const [scheduleStartAt, setScheduleStartAt] = useSubBlockValue(blockId, 'scheduleStartAt')
  const [scheduleTime, setScheduleTime] = useSubBlockValue(blockId, 'scheduleTime')
  const [minutesInterval, setMinutesInterval] = useSubBlockValue(blockId, 'minutesInterval')
  const [hourlyMinute, setHourlyMinute] = useSubBlockValue(blockId, 'hourlyMinute')
  const [dailyTime, setDailyTime] = useSubBlockValue(blockId, 'dailyTime')
  const [weeklyDay, setWeeklyDay] = useSubBlockValue(blockId, 'weeklyDay')
  const [weeklyDayTime, setWeeklyDayTime] = useSubBlockValue(blockId, 'weeklyDayTime')
  const [monthlyDay, setMonthlyDay] = useSubBlockValue(blockId, 'monthlyDay')
  const [monthlyTime, setMonthlyTime] = useSubBlockValue(blockId, 'monthlyTime')
  const [cronExpression, setCronExpression] = useSubBlockValue(blockId, 'cronExpression')
  const [timezone, setTimezone] = useSubBlockValue(blockId, 'timezone')

  // Get the startWorkflow value at the component level
  const [startWorkflow, setStartWorkflow] = useSubBlockValue(blockId, 'startWorkflow')

  // UI states
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Simpler approach - we'll use this to store the initial values when the modal opens
  const [initialValues, setInitialValues] = useState<Record<string, any>>({})

  // Initialize initial values when the modal opens
  useEffect(() => {
    if (isOpen) {
      // Capture all current values when modal opens
      const currentValues = {
        scheduleType: scheduleType || 'daily',
        scheduleStartAt: scheduleStartAt || '',
        scheduleTime: scheduleTime || '',
        minutesInterval: minutesInterval || '',
        hourlyMinute: hourlyMinute || '',
        dailyTime: dailyTime || '',
        weeklyDay: weeklyDay || 'MON',
        weeklyDayTime: weeklyDayTime || '',
        monthlyDay: monthlyDay || '',
        monthlyTime: monthlyTime || '',
        timezone: timezone || 'UTC',
        cronExpression: cronExpression || '',
      }

      setInitialValues(currentValues)
      setHasChanges(false)
      setErrorMessage(null)
    }
  }, [isOpen])

  // Track changes - simplified approach
  useEffect(() => {
    if (!isOpen) return

    const currentValues = {
      scheduleType: scheduleType || 'daily',
      scheduleStartAt: scheduleStartAt || '',
      scheduleTime: scheduleTime || '',
      minutesInterval: minutesInterval || '',
      hourlyMinute: hourlyMinute || '',
      dailyTime: dailyTime || '',
      weeklyDay: weeklyDay || 'MON',
      weeklyDayTime: weeklyDayTime || '',
      monthlyDay: monthlyDay || '',
      monthlyTime: monthlyTime || '',
      timezone: timezone || 'UTC',
      cronExpression: cronExpression || '',
    }

    // Simple JSON comparison to detect any changes
    const valuesChanged = JSON.stringify(initialValues) !== JSON.stringify(currentValues)

    // For new schedules, consider them changed if any value is set based on schedule type
    if (!scheduleId) {
      let hasRequiredFields = false

      switch (currentValues.scheduleType) {
        case 'minutes':
          hasRequiredFields = !!currentValues.minutesInterval
          break
        case 'hourly':
          hasRequiredFields = currentValues.hourlyMinute !== ''
          break
        case 'daily':
          hasRequiredFields = !!currentValues.dailyTime
          break
        case 'weekly':
          hasRequiredFields = !!currentValues.weeklyDay && !!currentValues.weeklyDayTime
          break
        case 'monthly':
          hasRequiredFields = !!currentValues.monthlyDay && !!currentValues.monthlyTime
          break
        case 'custom':
          hasRequiredFields = !!currentValues.cronExpression
          break
      }

      setHasChanges(valuesChanged || hasRequiredFields)
    } else {
      setHasChanges(valuesChanged)
    }
  }, [
    isOpen,
    scheduleId,
    scheduleType,
    scheduleStartAt,
    scheduleTime,
    minutesInterval,
    hourlyMinute,
    dailyTime,
    weeklyDay,
    weeklyDayTime,
    monthlyDay,
    monthlyTime,
    timezone,
    cronExpression,
    initialValues,
  ])

  // Handle modal close
  const handleClose = () => {
    if (hasChanges) {
      setShowUnsavedChangesConfirm(true)
    } else {
      onClose()
    }
  }

  // Handle confirming close despite unsaved changes
  const handleConfirmClose = () => {
    // Revert form values to initial values
    if (hasChanges) {
      setScheduleType(initialValues.scheduleType)
      setScheduleStartAt(initialValues.scheduleStartAt)
      setScheduleTime(initialValues.scheduleTime)
      setMinutesInterval(initialValues.minutesInterval)
      setHourlyMinute(initialValues.hourlyMinute)
      setDailyTime(initialValues.dailyTime)
      setWeeklyDay(initialValues.weeklyDay)
      setWeeklyDayTime(initialValues.weeklyDayTime)
      setMonthlyDay(initialValues.monthlyDay)
      setMonthlyTime(initialValues.monthlyTime)
      setTimezone(initialValues.timezone)
      setCronExpression(initialValues.cronExpression)
    }

    setShowUnsavedChangesConfirm(false)
    onClose()
  }

  // Handle canceling the close
  const handleCancelClose = () => {
    setShowUnsavedChangesConfirm(false)
  }

  // Handle saving the schedule
  const handleSave = async () => {
    setErrorMessage(null)
    setIsSaving(true)

    try {
      // Validate inputs based on schedule type
      if (scheduleType === 'minutes' && !minutesInterval) {
        setErrorMessage('Please enter minutes interval')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'hourly' && hourlyMinute === '') {
        setErrorMessage('Please enter minute of the hour')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'daily' && !dailyTime) {
        setErrorMessage('Please enter time of day')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'weekly' && !weeklyDayTime) {
        setErrorMessage('Please enter time of day')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'monthly' && (!monthlyDay || !monthlyTime)) {
        setErrorMessage('Please enter day of month and time')
        setIsSaving(false)
        return
      }

      if (scheduleType === 'custom' && !cronExpression) {
        setErrorMessage('Please enter a cron expression')
        setIsSaving(false)
        return
      }

      // Make sure the block's startWorkflow field is set to 'schedule'
      logger.debug('Current startWorkflow value:', startWorkflow)

      // Important: Set startWorkflow to 'schedule' in two ways for maximum reliability
      // 1. Via the hook which will trigger a state update
      if (startWorkflow !== 'schedule') {
        logger.debug('Setting startWorkflow to schedule via hook')
        setStartWorkflow('schedule')
      }

      // 2. Also directly set the value in the subblock store for immediate effect
      // This provides a more reliable way to ensure the value is set
      logger.debug('Setting startWorkflow to schedule directly in store')
      useSubBlockStore.getState().setValue(blockId, 'startWorkflow', 'schedule')

      // Give time for the state updates to propagate
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Call the onSave function passed from the parent component
      // This will handle the actual API call and store update
      const success = await onSave()

      if (success) {
        // Update initial values to match current state
        const updatedValues = {
          scheduleType: scheduleType || 'daily',
          scheduleStartAt: scheduleStartAt || '',
          scheduleTime: scheduleTime || '',
          minutesInterval: minutesInterval || '',
          hourlyMinute: hourlyMinute || '',
          dailyTime: dailyTime || '',
          weeklyDay: weeklyDay || 'MON',
          weeklyDayTime: weeklyDayTime || '',
          monthlyDay: monthlyDay || '',
          monthlyTime: monthlyTime || '',
          timezone: timezone || 'UTC',
          cronExpression: cronExpression || '',
        }
        logger.debug('Schedule saved successfully, updating initial values', updatedValues)
        setInitialValues(updatedValues)
        setHasChanges(false)
        onClose()
      }
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setErrorMessage('Failed to save schedule')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle deleting the schedule
  const handleDelete = async () => {
    if (!onDelete) return

    setIsDeleting(true)
    try {
      const success = await onDelete()

      if (success) {
        setShowDeleteConfirm(false)
        onClose()
      }
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setErrorMessage('Failed to delete schedule')
    } finally {
      setIsDeleting(false)
    }
  }

  // Open delete confirmation dialog
  const openDeleteConfirm = () => {
    setShowDeleteConfirm(true)
  }

  // Helper to format a date for display
  const formatDate = (date: string) => {
    try {
      return date ? format(new Date(date), 'PPP') : 'Select date'
    } catch (_e) {
      return 'Select date'
    }
  }

  return (
    <>
      <DialogContent className='flex flex-col gap-0 p-0 sm:max-w-[600px]' hideCloseButton>
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Schedule Configuration</DialogTitle>
            <Button variant='ghost' size='icon' className='h-8 w-8 p-0' onClick={handleClose}>
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='overflow-y-auto px-6 pt-4 pb-6'>
          {errorMessage && (
            <Alert variant='destructive' className='mb-4'>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className='space-y-6'>
            {/* Common date and time fields */}
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-1'>
                <label htmlFor='scheduleStartAt' className='font-medium text-sm'>
                  Start At
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id='scheduleStartAt'
                      variant='outline'
                      className='h-10 w-full justify-start text-left font-normal'
                    >
                      {formatDate(scheduleStartAt || '')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-auto p-0' align='start'>
                    <CalendarComponent
                      mode='single'
                      selected={scheduleStartAt ? new Date(scheduleStartAt) : undefined}
                      onSelect={(date) => setScheduleStartAt(date ? date.toISOString() : '')}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className='space-y-1'>
                <label htmlFor='scheduleTime' className='font-medium text-sm'>
                  Time
                </label>
                <TimeInput
                  blockId={blockId}
                  subBlockId='scheduleTime'
                  placeholder='Select time'
                  className='h-10'
                />
              </div>
            </div>

            {/* Frequency selector */}
            <div className='space-y-1'>
              <label htmlFor='scheduleType' className='font-medium text-sm'>
                Frequency
              </label>
              <Select
                value={scheduleType || 'daily'}
                onValueChange={(value) => setScheduleType(value)}
              >
                <SelectTrigger className='h-10'>
                  <SelectValue placeholder='Select frequency' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='minutes'>Every X Minutes</SelectItem>
                  <SelectItem value='hourly'>Hourly</SelectItem>
                  <SelectItem value='daily'>Daily</SelectItem>
                  <SelectItem value='weekly'>Weekly</SelectItem>
                  <SelectItem value='monthly'>Monthly</SelectItem>
                  <SelectItem value='custom'>Custom Cron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Minutes schedule options */}
            {scheduleType === 'minutes' && (
              <div className='space-y-1'>
                <label htmlFor='minutesInterval' className='font-medium text-sm'>
                  Run Every (minutes)
                </label>
                <Input
                  id='minutesInterval'
                  value={minutesInterval || ''}
                  onChange={(e) => setMinutesInterval(e.target.value)}
                  placeholder='15'
                  type='number'
                  min='1'
                  className='h-10'
                />
              </div>
            )}

            {/* Hourly schedule options */}
            {scheduleType === 'hourly' && (
              <div className='space-y-1'>
                <label htmlFor='hourlyMinute' className='font-medium text-sm'>
                  Minute of the Hour
                </label>
                <Input
                  id='hourlyMinute'
                  value={hourlyMinute || ''}
                  onChange={(e) => setHourlyMinute(e.target.value)}
                  placeholder='0'
                  type='number'
                  min='0'
                  max='59'
                  className='h-10'
                />
                <p className='text-muted-foreground text-xs'>
                  Specify which minute of each hour the workflow should run (0-59)
                </p>
              </div>
            )}

            {/* Daily schedule options */}
            {scheduleType === 'daily' && (
              <div className='space-y-1'>
                <label htmlFor='dailyTime' className='font-medium text-sm'>
                  Time of Day
                </label>
                <TimeInput
                  blockId={blockId}
                  subBlockId='dailyTime'
                  placeholder='Select time'
                  className='h-10'
                />
              </div>
            )}

            {/* Weekly schedule options */}
            {scheduleType === 'weekly' && (
              <div className='space-y-4'>
                <div className='space-y-1'>
                  <label htmlFor='weeklyDay' className='font-medium text-sm'>
                    Day of Week
                  </label>
                  <Select value={weeklyDay || 'MON'} onValueChange={(value) => setWeeklyDay(value)}>
                    <SelectTrigger className='h-10'>
                      <SelectValue placeholder='Select day' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='MON'>Monday</SelectItem>
                      <SelectItem value='TUE'>Tuesday</SelectItem>
                      <SelectItem value='WED'>Wednesday</SelectItem>
                      <SelectItem value='THU'>Thursday</SelectItem>
                      <SelectItem value='FRI'>Friday</SelectItem>
                      <SelectItem value='SAT'>Saturday</SelectItem>
                      <SelectItem value='SUN'>Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1'>
                  <label htmlFor='weeklyDayTime' className='font-medium text-sm'>
                    Time of Day
                  </label>
                  <TimeInput
                    blockId={blockId}
                    subBlockId='weeklyDayTime'
                    placeholder='Select time'
                    className='h-10'
                  />
                </div>
              </div>
            )}

            {/* Monthly schedule options */}
            {scheduleType === 'monthly' && (
              <div className='space-y-4'>
                <div className='space-y-1'>
                  <label htmlFor='monthlyDay' className='font-medium text-sm'>
                    Day of Month
                  </label>
                  <Input
                    id='monthlyDay'
                    value={monthlyDay || ''}
                    onChange={(e) => setMonthlyDay(e.target.value)}
                    placeholder='1'
                    type='number'
                    min='1'
                    max='31'
                    className='h-10'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Specify which day of the month the workflow should run (1-31)
                  </p>
                </div>

                <div className='space-y-1'>
                  <label htmlFor='monthlyTime' className='font-medium text-sm'>
                    Time of Day
                  </label>
                  <TimeInput
                    blockId={blockId}
                    subBlockId='monthlyTime'
                    placeholder='Select time'
                    className='h-10'
                  />
                </div>
              </div>
            )}

            {/* Custom cron options */}
            {scheduleType === 'custom' && (
              <div className='space-y-1'>
                <label htmlFor='cronExpression' className='font-medium text-sm'>
                  Cron Expression
                </label>
                <Input
                  id='cronExpression'
                  value={cronExpression || ''}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder='*/15 * * * *'
                  className='h-10'
                />
                <p className='mt-1 text-muted-foreground text-xs'>
                  Use standard cron format (e.g., "*/15 * * * *" for every 15 minutes)
                </p>
              </div>
            )}

            {/* Timezone configuration */}
            <div className='space-y-1'>
              <label htmlFor='timezone' className='font-medium text-sm'>
                Timezone
              </label>
              <Select value={timezone || 'UTC'} onValueChange={(value) => setTimezone(value)}>
                <SelectTrigger className='h-10'>
                  <SelectValue placeholder='Select timezone' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='UTC'>UTC</SelectItem>
                  <SelectItem value='America/New_York'>US Eastern (UTC-4)</SelectItem>
                  <SelectItem value='America/Chicago'>US Central (UTC-5)</SelectItem>
                  <SelectItem value='America/Denver'>US Mountain (UTC-6)</SelectItem>
                  <SelectItem value='America/Los_Angeles'>US Pacific (UTC-7)</SelectItem>
                  <SelectItem value='Europe/London'>London (UTC+1)</SelectItem>
                  <SelectItem value='Europe/Paris'>Paris (UTC+2)</SelectItem>
                  <SelectItem value='Asia/Singapore'>Singapore (UTC+8)</SelectItem>
                  <SelectItem value='Asia/Tokyo'>Tokyo (UTC+9)</SelectItem>
                  <SelectItem value='Australia/Sydney'>Sydney (UTC+10)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className='w-full px-6 pt-0 pb-6'>
          <div className='flex w-full justify-between'>
            <div>
              {scheduleId && onDelete && (
                <Button
                  type='button'
                  variant='destructive'
                  onClick={openDeleteConfirm}
                  disabled={isDeleting || isSaving}
                  size='default'
                  className='h-10'
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  {isDeleting ? 'Deleting...' : 'Delete Schedule'}
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={handleClose} size='default' className='h-10'>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className={cn('h-10', hasChanges ? 'bg-primary hover:bg-primary/90' : '')}
                size='default'
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      <UnsavedChangesDialog
        open={showUnsavedChangesConfirm}
        setOpen={setShowUnsavedChangesConfirm}
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this schedule? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-red-600 hover:bg-red-700'>
              {isDeleting ? 'Deleting...' : 'Delete Schedule'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
