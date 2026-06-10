'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  DatePicker,
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
  const [maxRuns, setMaxRuns] = useState(schedule?.maxRuns != null ? String(schedule.maxRuns) : '')
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

  const showTimezone = scheduleType !== 'minutes' && scheduleType !== 'hourly'

  const resolvedTimezone = showTimezone ? timezone : 'UTC'

  const schedulePreview = useMemo(() => {
    if (!computedCron) return null
    const validation = validateCronExpression(computedCron, resolvedTimezone)
    if (!validation.isValid) return { error: validation.error }
    return {
      humanReadable: parseCronToHumanReadable(computedCron, resolvedTimezone),
      nextRun: validation.nextRun,
    }
  }, [computedCron, resolvedTimezone])

  const isFormValid = Boolean(
    title.trim() &&
      prompt.trim() &&
      computedCron &&
      schedulePreview &&
      !('error' in schedulePreview)
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

  /**
   * Single close/open handler for every close path (footer Cancel, header X,
   * Esc, and overlay click). The create-mode instance stays mounted between
   * opens, so any close must also reset the draft to avoid stale values
   * reappearing on the next open.
   */
  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) resetForm()
  }

  const handleClose = () => {
    handleOpenChange(false)
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
      setSubmitError(getErrorMessage(error, 'Failed to save scheduled task. Please try again.'))
    }
  }

  const modalTitle = isEditing ? 'Edit scheduled task' : 'Create new scheduled task'

  return (
    <ChipModal open={open} onOpenChange={handleOpenChange} srTitle={modalTitle} size='lg'>
      <ChipModalHeader onClose={handleClose}>{modalTitle}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Title'
          value={title}
          onChange={(value) => {
            setTitle(value)
            if (submitError) setSubmitError(null)
          }}
          placeholder='e.g., Daily report generation'
          autoComplete='off'
          onSubmit={handleSubmit}
        />

        <ChipModalField
          type='textarea'
          title='Task description'
          value={prompt}
          onChange={(value) => {
            setPrompt(value)
            if (submitError) setSubmitError(null)
          }}
          placeholder='Describe what this scheduled task should do...'
          minHeight={80}
        />

        <ChipModalField type='custom' title='Run frequency'>
          <ChipCombobox
            options={SCHEDULE_TYPE_OPTIONS}
            value={scheduleType}
            onChange={(v) => setScheduleType(v as ScheduleType)}
            placeholder='Select frequency'
          />
        </ChipModalField>

        {scheduleType === 'minutes' && (
          <ChipModalField type='custom' title='Interval (minutes)'>
            <ChipInput
              type='number'
              value={minutesInterval}
              onChange={(e) => setMinutesInterval(e.target.value)}
              placeholder='15'
              min={1}
              max={1440}
            />
          </ChipModalField>
        )}

        {scheduleType === 'hourly' && (
          <ChipModalField type='custom' title='Minute of hour'>
            <ChipInput
              type='number'
              value={hourlyMinute}
              onChange={(e) => setHourlyMinute(e.target.value)}
              placeholder='0'
              min={0}
              max={59}
            />
          </ChipModalField>
        )}

        {scheduleType === 'daily' && (
          <ChipModalField type='custom' title='Time'>
            <TimePicker value={dailyTime} onChange={setDailyTime} />
          </ChipModalField>
        )}

        {scheduleType === 'weekly' && (
          <div className='flex gap-3'>
            <ChipModalField type='custom' title='Day of week' className='flex-1'>
              <ChipCombobox options={WEEKDAY_OPTIONS} value={weeklyDay} onChange={setWeeklyDay} />
            </ChipModalField>
            <ChipModalField type='custom' title='Time' className='flex-1'>
              <TimePicker value={weeklyDayTime} onChange={setWeeklyDayTime} />
            </ChipModalField>
          </div>
        )}

        {scheduleType === 'monthly' && (
          <div className='flex gap-3'>
            <ChipModalField type='custom' title='Day of month' className='flex-1'>
              <ChipInput
                type='number'
                value={monthlyDay}
                onChange={(e) => setMonthlyDay(e.target.value)}
                placeholder='1'
                min={1}
                max={31}
              />
            </ChipModalField>
            <ChipModalField type='custom' title='Time' className='flex-1'>
              <TimePicker value={monthlyTime} onChange={setMonthlyTime} />
            </ChipModalField>
          </div>
        )}

        {scheduleType === 'custom' && (
          <ChipModalField type='custom' title='Cron expression'>
            <ChipInput
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder='0 9 * * *'
              inputClassName='font-mono'
              autoComplete='off'
            />
          </ChipModalField>
        )}

        {showTimezone && (
          <ChipModalField type='custom' title='Timezone'>
            <ChipCombobox
              options={TIMEZONE_OPTIONS}
              value={timezone}
              onChange={setTimezone}
              searchable
              searchPlaceholder='Search timezones...'
              maxHeight={240}
            />
          </ChipModalField>
        )}

        {!isEditing && (
          <ChipModalField
            type='custom'
            title={
              <>
                Start date
                <span className='ml-1 font-normal text-[var(--text-muted)]'>(optional)</span>
              </>
            }
          >
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              placeholder='Starts immediately'
            />
          </ChipModalField>
        )}

        <ChipModalField type='custom' title='Lifecycle'>
          <ButtonGroup
            value={lifecycle}
            onValueChange={(value) => setLifecycle(value as 'persistent' | 'until_complete')}
          >
            <ButtonGroupItem value='persistent'>Recurring</ButtonGroupItem>
            <ButtonGroupItem value='until_complete'>Number of runs</ButtonGroupItem>
          </ButtonGroup>
        </ChipModalField>

        {lifecycle === 'until_complete' && (
          <ChipModalField
            type='custom'
            title={
              <>
                Max runs
                <span className='ml-1 font-normal text-[var(--text-muted)]'>(optional)</span>
              </>
            }
          >
            <ChipInput
              type='number'
              value={maxRuns}
              onChange={(e) => setMaxRuns(e.target.value)}
              placeholder='No limit'
              min={1}
            />
          </ChipModalField>
        )}

        {computedCron && schedulePreview && (
          <div className='px-2'>
            {'error' in schedulePreview ? (
              <p className='text-[var(--text-error)] text-caption'>{schedulePreview.error}</p>
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

        <ChipModalError>{submitError}</ChipModalError>
      </ChipModalBody>

      <ChipModalFooter
        onCancel={handleClose}
        primaryAction={{
          label: isEditing
            ? updateScheduleMutation.isPending
              ? 'Saving...'
              : 'Save changes'
            : createScheduleMutation.isPending
              ? 'Creating...'
              : 'Create',
          onClick: handleSubmit,
          disabled:
            !isFormValid || createScheduleMutation.isPending || updateScheduleMutation.isPending,
        }}
      />
    </ChipModal>
  )
}
