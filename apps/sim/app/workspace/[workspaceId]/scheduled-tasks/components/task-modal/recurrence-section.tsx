'use client'

import { useRef } from 'react'
import {
  CalendarDayCell,
  ChipDatePicker,
  ChipModalField,
  ChipModalSeparator,
  Switch,
} from '@sim/emcn'
import { format } from 'date-fns'
import type {
  MonthlyMode,
  Recurrence,
  RecurrenceFrequency,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'

const WEEKDAY_PRESET = [1, 2, 3, 4, 5]
/** Seed count when the user first chooses "ends after N runs". */
const DEFAULT_END_AFTER_COUNT = 10
/** Cadence a task falls back to when the user first flips on recurrence. */
const DEFAULT_RECURRING_FREQUENCY = 'daily'

/** Sunday-first weekday order with single-letter labels and full names for a11y. */
const WEEKDAYS = [
  { value: 0, short: 'S', name: 'Sunday' },
  { value: 1, short: 'M', name: 'Monday' },
  { value: 2, short: 'T', name: 'Tuesday' },
  { value: 3, short: 'W', name: 'Wednesday' },
  { value: 4, short: 'T', name: 'Thursday' },
  { value: 5, short: 'F', name: 'Friday' },
  { value: 6, short: 'S', name: 'Saturday' },
] as const

/** Ordinal words for the 1st–5th weekday-of-month, matching a calendar app's labels. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const

/** The frequency presets the dropdown authors, keyed by a synthetic option value. */
type FrequencyOption = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly' | 'custom'

function isWeekdayPreset(weekdays: number[]): boolean {
  return (
    weekdays.length === WEEKDAY_PRESET.length && WEEKDAY_PRESET.every((d) => weekdays.includes(d))
  )
}

/**
 * Collapses a recurring recurrence into the single dropdown value that
 * represents it. `once` maps to the default cadence as an exhaustiveness
 * fallback: callers gate on `isRecurring`, so it never reaches here at runtime,
 * but the dropdown can't represent it — mapping it keeps the return type
 * `FrequencyOption` without a cast.
 */
function frequencyOptionFor(recurrence: Recurrence): FrequencyOption {
  if (recurrence.frequency === 'weekly')
    return isWeekdayPreset(recurrence.weekdays) ? 'weekdays' : 'weekly'
  if (recurrence.frequency === 'monthly') return 'monthly'
  if (recurrence.frequency === 'yearly') return 'yearly'
  if (recurrence.frequency === 'custom') return 'custom'
  if (recurrence.frequency === 'once') return DEFAULT_RECURRING_FREQUENCY
  return recurrence.frequency
}

/**
 * The monthly sub-options, derived from the launch date the same way a calendar
 * app offers them: repeat on the day number, on the ordinal weekday of the
 * month (e.g. the third Tuesday), or on the last weekday of the month.
 *
 * The ordinal anchor is offered only for the 1st–4th occurrence: a 5th
 * occurrence is always the month's last weekday, so — like a calendar app — it
 * is folded into the "last weekday" option rather than offering a "fifth" that
 * would silently skip months without a 5th occurrence.
 */
function monthlyModeOptions(launch: Date): Array<{ value: MonthlyMode; label: string }> {
  const weekdayName = format(launch, 'EEEE')
  const ordinal = Math.ceil(launch.getDate() / 7)
  const options: Array<{ value: MonthlyMode; label: string }> = [
    { value: 'day-of-month', label: `On day ${format(launch, 'd')}` },
  ]
  if (ordinal <= 4)
    options.push({ value: 'nth-weekday', label: `On the ${ORDINALS[ordinal - 1]} ${weekdayName}` })
  options.push({ value: 'last-weekday', label: `On the last ${weekdayName}` })
  return options
}

interface RecurrenceSectionProps {
  recurrence: Recurrence
  onChange: (recurrence: Recurrence) => void
  /** The launch day, so weekly/monthly labels name the weekday and day-of-month. */
  launchDate: string
}

/**
 * The repeat + end controls for a scheduled task, rendered as a body section
 * below the prompt: a "Recurring" {@link Switch} that toggles a one-time launch
 * into a repeat, and — once on — the frequency preset, its cadence detail (the
 * weekly day toggles or the monthly anchor), and how it ends (never, on a date,
 * or after N runs).
 *
 * Composed as a sibling between the prompt body and footer; it owns its own
 * leading separator and mirrors {@link ChipModalBody}'s spacing
 * (`gap-4 px-2 pt-4 pb-4.5`) so every {@link ChipModalField} lands at the same
 * effective `px-4` as the modal header/footer — no changes to the `ChipModal`
 * primitives.
 */
export function RecurrenceSection({ recurrence, onChange, launchDate }: RecurrenceSectionProps) {
  /**
   * The cadence to reinstate when recurrence is toggled back on. Toggling off
   * collapses `frequency` to `once`, dropping which preset was active, so the
   * last recurring cadence is cached here and restored — a paused "Weekly on
   * Mon" returns as weekly, not silently reset to daily. Written during render
   * (an idempotent cache), so it is current before the toggle handler reads it.
   */
  const lastRecurringFrequency = useRef<RecurrenceFrequency>(DEFAULT_RECURRING_FREQUENCY)
  if (recurrence.frequency !== 'once') lastRecurringFrequency.current = recurrence.frequency

  const launch = new Date(`${launchDate}T00:00`)
  const isRecurring = recurrence.frequency !== 'once'
  const selectedWeekdays = recurrence.weekdays.length > 0 ? recurrence.weekdays : [launch.getDay()]

  const monthlyOptions = monthlyModeOptions(launch)
  const monthlyMode = recurrence.monthlyMode ?? 'day-of-month'
  // If the launch date drifted to a 5th occurrence, the nth anchor is no longer
  // offered; fall back to "last weekday", which is exactly what it compiles to.
  const monthlyValue = monthlyOptions.some((option) => option.value === monthlyMode)
    ? monthlyMode
    : 'last-weekday'

  const frequencyOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: `Yearly on ${format(launch, 'MMM d')}` },
    ...(recurrence.frequency === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
  ]

  /**
   * Flips the one-time launch into a repeat and back. Toggling off keeps the
   * recurrence shape (weekdays, end, and a passed-through `custom` cron) on the
   * object and only collapses `frequency` to `once`; toggling back on reinstates
   * the remembered cadence, so neither a weekly preset nor a conversationally
   * authored custom cron is silently rewritten to daily.
   */
  const handleRecurringToggle = (checked: boolean) => {
    onChange({ ...recurrence, frequency: checked ? lastRecurringFrequency.current : 'once' })
  }

  const handleFrequencyChange = (value: string) => {
    const option = value as FrequencyOption
    switch (option) {
      case 'daily':
        onChange({ ...recurrence, frequency: 'daily', weekdays: [], cron: undefined })
        return
      case 'weekly':
        onChange({
          ...recurrence,
          frequency: 'weekly',
          weekdays: [launch.getDay()],
          cron: undefined,
        })
        return
      case 'weekdays':
        onChange({
          ...recurrence,
          frequency: 'weekly',
          weekdays: [...WEEKDAY_PRESET],
          cron: undefined,
        })
        return
      case 'monthly':
        onChange({
          ...recurrence,
          frequency: 'monthly',
          weekdays: [],
          monthlyMode: recurrence.monthlyMode ?? 'day-of-month',
          cron: undefined,
        })
        return
      case 'yearly':
        onChange({ ...recurrence, frequency: 'yearly', weekdays: [], cron: undefined })
        return
      case 'custom':
        onChange({ ...recurrence, frequency: 'custom' })
    }
  }

  /** Toggles a weekday on or off, never letting the last selected day be cleared. */
  const handleWeekdayToggle = (day: number) => {
    const isSelected = selectedWeekdays.includes(day)
    if (isSelected && selectedWeekdays.length === 1) return
    const weekdays = isSelected
      ? selectedWeekdays.filter((d) => d !== day)
      : [...selectedWeekdays, day].sort((a, b) => a - b)
    onChange({ ...recurrence, weekdays })
  }

  const handleEndChange = (value: string) => {
    if (value === 'never') onChange({ ...recurrence, end: { type: 'never' } })
    else if (value === 'on')
      onChange({ ...recurrence, end: { type: 'on', date: format(launch, 'yyyy-MM-dd') } })
    else {
      const count = recurrence.end.type === 'after' ? recurrence.end.count : DEFAULT_END_AFTER_COUNT
      onChange({ ...recurrence, end: { type: 'after', count } })
    }
  }

  return (
    <div className='flex flex-col'>
      <ChipModalSeparator />
      <div className='flex flex-col gap-4 px-2 pt-4 pb-4.5'>
        <ChipModalField type='custom' title='Recurring'>
          <Switch checked={isRecurring} onCheckedChange={handleRecurringToggle} />
        </ChipModalField>

        {isRecurring && (
          <>
            <ChipModalField
              type='dropdown'
              title='Frequency'
              value={frequencyOptionFor(recurrence)}
              options={frequencyOptions}
              onChange={handleFrequencyChange}
            />

            {recurrence.frequency === 'weekly' && (
              <ChipModalField type='custom' title='Repeat on'>
                {/* A one-row extract of the calendar: seven equal day cells built
                    from the same {@link CalendarDayCell} the date picker uses, so
                    the weekday toggles read as a sibling of the calendar rather than
                    a separate segmented bar. */}
                <div className='grid grid-cols-7 gap-1'>
                  {WEEKDAYS.map((weekday) => {
                    const selected = selectedWeekdays.includes(weekday.value)
                    return (
                      <CalendarDayCell
                        key={weekday.value}
                        selected={selected}
                        fullWidth
                        aria-pressed={selected}
                        aria-label={weekday.name}
                        onClick={() => handleWeekdayToggle(weekday.value)}
                      >
                        {weekday.short}
                      </CalendarDayCell>
                    )
                  })}
                </div>
              </ChipModalField>
            )}

            {recurrence.frequency === 'monthly' && (
              <ChipModalField
                type='dropdown'
                title='On'
                value={monthlyValue}
                options={monthlyOptions}
                onChange={(value) => onChange({ ...recurrence, monthlyMode: value as MonthlyMode })}
              />
            )}

            <ChipModalField
              type='dropdown'
              title='Ends'
              value={recurrence.end.type}
              options={[
                { value: 'never', label: 'No end' },
                { value: 'on', label: 'Ends on' },
                { value: 'after', label: 'Ends after' },
              ]}
              onChange={handleEndChange}
            />

            {recurrence.end.type === 'on' && (
              <ChipModalField type='custom' title='End date'>
                <ChipDatePicker
                  value={recurrence.end.date}
                  onChange={(date) => onChange({ ...recurrence, end: { type: 'on', date } })}
                  fullWidth
                />
              </ChipModalField>
            )}

            {recurrence.end.type === 'after' && (
              <ChipModalField
                type='input'
                title='Number of runs'
                value={String(recurrence.end.count)}
                onChange={(value) => {
                  const count = Math.max(1, Math.floor(Number(value) || 1))
                  onChange({ ...recurrence, end: { type: 'after', count } })
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
