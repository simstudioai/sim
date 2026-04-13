'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Combobox,
  DatePicker,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  TimePicker,
} from '@/components/emcn'
import type { ScheduleType } from '@/lib/workflows/schedules/utils'
import {
  DAY_MAP,
  parseCronToHumanReadable,
  parseCronToScheduleType,
  validateCronExpression,
} from '@/lib/workflows/schedules/utils'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'
import { useCreateSchedule, useUpdateSchedule } from '@/hooks/queries/schedules'

const logger = createLogger('ScheduleModal')

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

type SelectOption = { label: string; value: string }

const SCHEDULE_TYPE_OPTIONS: SelectOption[] = [
  { label: 'Every X Minutes', value: 'minutes' },
  { label: 'Hourly', value: 'hourly' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Custom (Cron)', value: 'custom' },
]

const WEEKDAY_OPTIONS: SelectOption[] = [
  { label: 'Monday', value: 'MON' },
  { label: 'Tuesday', value: 'TUE' },
  { label: 'Wednesday', value: 'WED' },
  { label: 'Thursday', value: 'THU' },
  { label: 'Friday', value: 'FRI' },
  { label: 'Saturday', value: 'SAT' },
  { label: 'Sunday', value: 'SUN' },
]

const TIMEZONE_OPTIONS: SelectOption[] = [
  { label: 'UTC', value: 'UTC' },
  { label: 'US Pacific (UTC-8)', value: 'America/Los_Angeles' },
  { label: 'US Mountain (UTC-7)', value: 'America/Denver' },
  { label: 'US Central (UTC-6)', value: 'America/Chicago' },
  { label: 'US Eastern (UTC-5)', value: 'America/New_York' },
  { label: 'US Alaska (UTC-9)', value: 'America/Anchorage' },
  { label: 'US Hawaii (UTC-10)', value: 'Pacific/Honolulu' },
  { label: 'Canada Toronto (UTC-5)', value: 'America/Toronto' },
  { label: 'Canada Vancouver (UTC-8)', value: 'America/Vancouver' },
  { label: 'Mexico City (UTC-6)', value: 'America/Mexico_City' },
  { label: 'São Paulo (UTC-3)', value: 'America/Sao_Paulo' },
  { label: 'Buenos Aires (UTC-3)', value: 'America/Argentina/Buenos_Aires' },
  { label: 'London (UTC+0)', value: 'Europe/London' },
  { label: 'Paris (UTC+1)', value: 'Europe/Paris' },
  { label: 'Berlin (UTC+1)', value: 'Europe/Berlin' },
  { label: 'Amsterdam (UTC+1)', value: 'Europe/Amsterdam' },
  { label: 'Madrid (UTC+1)', value: 'Europe/Madrid' },
  { label: 'Rome (UTC+1)', value: 'Europe/Rome' },
  { label: 'Moscow (UTC+3)', value: 'Europe/Moscow' },
  { label: 'Dubai (UTC+4)', value: 'Asia/Dubai' },
  { label: 'Tel Aviv (UTC+2)', value: 'Asia/Tel_Aviv' },
  { label: 'Cairo (UTC+2)', value: 'Africa/Cairo' },
  { label: 'Johannesburg (UTC+2)', value: 'Africa/Johannesburg' },
  { label: 'India (UTC+5:30)', value: 'Asia/Kolkata' },
  { label: 'Bangkok (UTC+7)', value: 'Asia/Bangkok' },
  { label: 'Jakarta (UTC+7)', value: 'Asia/Jakarta' },
  { label: 'Singapore (UTC+8)', value: 'Asia/Singapore' },
  { label: 'China (UTC+8)', value: 'Asia/Shanghai' },
  { label: 'Hong Kong (UTC+8)', value: 'Asia/Hong_Kong' },
  { label: 'Seoul (UTC+9)', value: 'Asia/Seoul' },
  { label: 'Tokyo (UTC+9)', value: 'Asia/Tokyo' },
  { label: 'Perth (UTC+8)', value: 'Australia/Perth' },
  { label: 'Sydney (UTC+10)', value: 'Australia/Sydney' },
  { label: 'Melbourne (UTC+10)', value: 'Australia/Melbourne' },
  { label: 'Auckland (UTC+12)', value: 'Pacific/Auckland' },
]

interface ScheduleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  schedule?: WorkspaceScheduleData
}

/**
 * Builds a cron expression from schedule type and options.
 * Returns null if the required fields for the selected type are incomplete.
 */
function buildCronExpression(
  scheduleType: ScheduleType,
  options: {
    minutesInterval: string
    hourlyMinute: string
    dailyTime: string
    weeklyDay: string
    weeklyDayTime: string
    monthlyDay: string
    monthlyTime: string
    cronExpression: string
  }
): string | null {
  switch (scheduleType) {
    case 'minutes': {
      const interval = Number.parseInt(options.minutesInterval, 10)
      if (!interval || interval < 1 || interval > 1440) return null
      return `*/${interval} * * * *`
    }
    case 'hourly': {
      const minute = Number.parseInt(options.hourlyMinute, 10)
      if (Number.isNaN(minute) || minute < 0 || minute > 59) return null
      return `${minute} * * * *`
    }
    case 'daily': {
      if (!options.dailyTime) return null
      const [hours, minutes] = options.dailyTime.split(':')
      return `${Number.parseInt(minutes, 10)} ${Number.parseInt(hours, 10)} * * *`
    }
    case 'weekly': {
      if (!options.weeklyDay || !options.weeklyDayTime) return null
      const day = DAY_MAP[options.weeklyDay]
      if (day === undefined) return null
      const [hours, minutes] = options.weeklyDayTime.split(':')
      return `${Number.parseInt(minutes, 10)} ${Number.parseInt(hours, 10)} * * ${day}`
    }
    case 'monthly': {
      const dayOfMonth = Number.parseInt(options.monthlyDay, 10)
      if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31 || !options.monthlyTime) return null
      const [hours, minutes] = options.monthlyTime.split(':')
      return `${Number.parseInt(minutes, 10)} ${Number.parseInt(hours, 10)} ${dayOfMonth} * *`
    }
    case 'custom': {
      return options.cronExpression.trim() || null
    }
    default:
      return null
  }
}

/**
 * Modal for creating and editing scheduled tasks.
 *
 * All `useState` initializers read from the `schedule` prop at mount time only.
 * When editing an existing task, the call-site **must** supply a `key` prop equal to the
 * task's ID so React remounts the component when the selected task changes — otherwise
 * the form will display stale values from the previously selected task.
 */
export function ScheduleModal({ open, onOpenChange, workspaceId, schedule }: ScheduleModalProps) {
  const createScheduleMutation = useCreateSchedule()
  const updateScheduleMutation = useUpdateSchedule()

  const isEditing = Boolean(schedule)

  const initialCronState = useMemo(
    () => (schedule ? parseCronToScheduleType(schedule.cronExpression) : null),
    [schedule]
  )

  const [title, setTitle] = useState(schedule?.jobTitle ?? '')
  const [prompt, setPrompt] = useState(schedule?.prompt ?? '')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    initialCronState?.scheduleType ?? 'daily'
  )
  const [minutesInterval, setMinutesInterval] = useState(initialCronState?.minutesInterval ?? '15')
  const [hourlyMinute, setHourlyMinute] = useState(initialCronState?.hourlyMinute ?? '0')
  const [dailyTime, setDailyTime] = useState(initialCronState?.dailyTime ?? '09:00')
  const [weeklyDay, setWeeklyDay] = useState(initialCronState?.weeklyDay ?? 'MON')
  const [weeklyDayTime, setWeeklyDayTime] = useState(initialCronState?.weeklyDayTime ?? '09:00')
  const [monthlyDay, setMonthlyDay] = useState(initialCronState?.monthlyDay ?? '1')
  const [monthlyTime, setMonthlyTime] = useState(initialCronState?.monthlyTime ?? '09:00')
  const [cronExpression, setCronExpression] = useState(initialCronState?.cronExpression ?? '')
  const [timezone, setTimezone] = useState(schedule?.timezone ?? DEFAULT_TIMEZONE)
  const [startDate, setStartDate] = useState('')
  const [lifecycle, setLifecycle] = useState<'persistent' | 'until_complete'>(
    schedule?.lifecycle === 'until_complete' ? 'until_complete' : 'persistent'
  )
  const [maxRuns, setMaxRuns] = useState(schedule?.maxRuns ? String(schedule.maxRuns) : '')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const computedCron = useMemo(
    () =>
      buildCronExpression(scheduleType, {
        minutesInterval,
        hourlyMinute,
        dailyTime,
        weeklyDay,
        weeklyDayTime,
        monthlyDay,
        monthlyTime,
        cronExpression,
      }),
    [
      scheduleType,
      minutesInterval,
      hourlyMinute,
      dailyTime,
      weeklyDay,
      weeklyDayTime,
      monthlyDay,
      monthlyTime,
      cronExpression,
    ]
  )

  const showTimezone = useMemo(
    () => scheduleType !== 'minutes' && scheduleType !== 'hourly',
    [scheduleType]
  )

  const resolvedTimezone = useMemo(
    () => (showTimezone ? timezone : 'UTC'),
    [showTimezone, timezone]
  )

  const schedulePreview = useMemo(() => {
    if (!computedCron) return null
    const validation = validateCronExpression(computedCron, resolvedTimezone)
    if (!validation.isValid) return { error: validation.error }
    return {
      humanReadable: parseCronToHumanReadable(computedCron, resolvedTimezone),
      nextRun: validation.nextRun,
    }
  }, [computedCron, resolvedTimezone])

  const isFormValid = useMemo(
    () =>
      title.trim() &&
      prompt.trim() &&
      computedCron &&
      schedulePreview &&
      !('error' in schedulePreview),
    [title, prompt, computedCron, schedulePreview]
  )

  const resetForm = () => {
    setTitle('')
    setPrompt('')
    setScheduleType('daily')
    setMinutesInterval('15')
    setHourlyMinute('0')
    setDailyTime('09:00')
    setWeeklyDay('MON')
    setWeeklyDayTime('09:00')
    setMonthlyDay('1')
    setMonthlyTime('09:00')
    setCronExpression('')
    setTimezone(DEFAULT_TIMEZONE)
    setStartDate('')
    setLifecycle('persistent')
    setMaxRuns('')
    setSubmitError(null)
  }

  const handleClose = () => {
    onOpenChange(false)
    resetForm()
  }

  const handleSubmit = async () => {
    if (!computedCron || !isFormValid) return

    setSubmitError(null)
    try {
      if (isEditing && schedule) {
        await updateScheduleMutation.mutateAsync({
          scheduleId: schedule.id,
          workspaceId,
          title: title.trim(),
          prompt: prompt.trim(),
          cronExpression: computedCron,
          timezone: resolvedTimezone,
          lifecycle,
          maxRuns: lifecycle === 'until_complete' && maxRuns ? Number.parseInt(maxRuns, 10) : null,
        })
      } else {
        await createScheduleMutation.mutateAsync({
          workspaceId,
          title: title.trim(),
          prompt: prompt.trim(),
          cronExpression: computedCron,
          timezone: resolvedTimezone,
          lifecycle,
          maxRuns:
            lifecycle === 'until_complete' && maxRuns ? Number.parseInt(maxRuns, 10) : undefined,
          startDate: startDate || undefined,
        })
      }
      handleClose()
    } catch (error: unknown) {
      logger.error('Schedule submission failed:', { error })
      setSubmitError(
        error instanceof Error ? error.message : 'Failed to save scheduled task. Please try again.'
      )
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='lg'>
        <ModalHeader>{isEditing ? 'Edit scheduled task' : 'Create new scheduled task'}</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-4.5'>
            <div className='flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>Title</p>
              <EmcnInput
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (submitError) setSubmitError(null)
                }}
                placeholder='e.g., Daily report generation'
                className='h-9'
                autoComplete='off'
              />
            </div>

            <div className='flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>Task description</p>
              <Textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value)
                  if (submitError) setSubmitError(null)
                }}
                placeholder='Describe what this scheduled task should do...'
                className='min-h-[80px] resize-none'
              />
            </div>

            <div className='flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>Run frequency</p>
              <Combobox
                options={SCHEDULE_TYPE_OPTIONS}
                value={scheduleType}
                onChange={(v) => setScheduleType(v as ScheduleType)}
                placeholder='Select frequency'
              />
            </div>

            {scheduleType === 'minutes' && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  Interval (minutes)
                </p>
                <EmcnInput
                  type='number'
                  value={minutesInterval}
                  onChange={(e) => setMinutesInterval(e.target.value)}
                  placeholder='15'
                  min={1}
                  max={1440}
                  className='h-9'
                />
              </div>
            )}

            {scheduleType === 'hourly' && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>Minute of hour</p>
                <EmcnInput
                  type='number'
                  value={hourlyMinute}
                  onChange={(e) => setHourlyMinute(e.target.value)}
                  placeholder='0'
                  min={0}
                  max={59}
                  className='h-9'
                />
              </div>
            )}

            {scheduleType === 'daily' && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>Time</p>
                <TimePicker value={dailyTime} onChange={setDailyTime} />
              </div>
            )}

            {scheduleType === 'weekly' && (
              <div className='flex gap-3'>
                <div className='flex flex-1 flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Day of week</p>
                  <Combobox options={WEEKDAY_OPTIONS} value={weeklyDay} onChange={setWeeklyDay} />
                </div>
                <div className='flex flex-1 flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Time</p>
                  <TimePicker value={weeklyDayTime} onChange={setWeeklyDayTime} />
                </div>
              </div>
            )}

            {scheduleType === 'monthly' && (
              <div className='flex gap-3'>
                <div className='flex flex-1 flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Day of month</p>
                  <EmcnInput
                    type='number'
                    value={monthlyDay}
                    onChange={(e) => setMonthlyDay(e.target.value)}
                    placeholder='1'
                    min={1}
                    max={31}
                    className='h-9'
                  />
                </div>
                <div className='flex flex-1 flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Time</p>
                  <TimePicker value={monthlyTime} onChange={setMonthlyTime} />
                </div>
              </div>
            )}

            {scheduleType === 'custom' && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>Cron expression</p>
                <EmcnInput
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder='0 9 * * *'
                  className='h-9 font-mono'
                  autoComplete='off'
                />
              </div>
            )}

            {showTimezone && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>Timezone</p>
                <Combobox
                  options={TIMEZONE_OPTIONS}
                  value={timezone}
                  onChange={setTimezone}
                  searchable
                  searchPlaceholder='Search timezones...'
                  maxHeight={240}
                />
              </div>
            )}

            {!isEditing && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  Start date
                  <span className='ml-1 font-normal text-[var(--text-muted)]'>(optional)</span>
                </p>
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  placeholder='Starts immediately'
                />
              </div>
            )}

            <div className='flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>Lifecycle</p>
              <ButtonGroup
                value={lifecycle}
                onValueChange={(value) => setLifecycle(value as 'persistent' | 'until_complete')}
              >
                <ButtonGroupItem value='persistent'>Recurring</ButtonGroupItem>
                <ButtonGroupItem value='until_complete'>Number of runs</ButtonGroupItem>
              </ButtonGroup>
            </div>

            {lifecycle === 'until_complete' && (
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  Max runs
                  <span className='ml-1 font-normal text-[var(--text-muted)]'>(optional)</span>
                </p>
                <EmcnInput
                  type='number'
                  value={maxRuns}
                  onChange={(e) => setMaxRuns(e.target.value)}
                  placeholder='No limit'
                  min={1}
                  className='h-9'
                />
              </div>
            )}

            {computedCron && schedulePreview && (
              <div>
                {'error' in schedulePreview ? (
                  <p className='text-[var(--text-error)] text-small'>{schedulePreview.error}</p>
                ) : (
                  <div className='flex flex-col gap-1'>
                    <p className='text-[var(--text-secondary)] text-small'>
                      {schedulePreview.humanReadable}
                    </p>
                    {schedulePreview.nextRun && (
                      <p className='text-[var(--text-muted)] text-caption'>
                        Next run:{' '}
                        {schedulePreview.nextRun.toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {submitError && (
              <p className='text-[var(--text-error)] text-small leading-tight'>{submitError}</p>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant='default' onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            onClick={handleSubmit}
            disabled={
              !isFormValid || createScheduleMutation.isPending || updateScheduleMutation.isPending
            }
          >
            {isEditing
              ? updateScheduleMutation.isPending
                ? 'Saving...'
                : 'Save changes'
              : createScheduleMutation.isPending
                ? 'Creating...'
                : 'Create'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
