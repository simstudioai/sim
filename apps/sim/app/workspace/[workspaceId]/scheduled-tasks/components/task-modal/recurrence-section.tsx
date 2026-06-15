'use client'

import { useRef } from 'react'
import { format } from 'date-fns'
import { ChipDatePicker, ChipModalField, ChipModalSeparator, Switch } from '@/components/emcn'
import type {
  Recurrence,
  RecurrenceFrequency,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'

const WEEKDAY_PRESET = [1, 2, 3, 4, 5]
/** Seed count when the user first chooses "ends after N runs". */
const DEFAULT_END_AFTER_COUNT = 10
/** Cadence a task falls back to when the user first flips on recurrence. */
const DEFAULT_RECURRING_FREQUENCY = 'daily'

/** The frequency presets the dropdown authors, keyed by a synthetic option value. */
type FrequencyOption = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom'

function isWeekdayPreset(weekdays: number[]): boolean {
  return (
    weekdays.length === WEEKDAY_PRESET.length && WEEKDAY_PRESET.every((d) => weekdays.includes(d))
  )
}

/** Collapses a recurring recurrence into the single dropdown value that represents it. */
function frequencyOptionFor(recurrence: Recurrence): FrequencyOption {
  if (recurrence.frequency === 'weekly')
    return isWeekdayPreset(recurrence.weekdays) ? 'weekdays' : 'weekly'
  // Exhaustiveness fallback: callers gate on `isRecurring`, so `once` never
  // reaches here at runtime, but the dropdown can't represent it — mapping it to
  // a recurring default keeps the return type `FrequencyOption` without a cast.
  if (recurrence.frequency === 'once') return DEFAULT_RECURRING_FREQUENCY
  return recurrence.frequency
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
 * into a repeat, and — once on — the frequency preset and how it ends (never, on
 * a date, or after N runs).
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

  const frequencyOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: `Weekly on ${format(launch, 'EEE')}` },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'monthly', label: `Monthly on the ${format(launch, 'do')}` },
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
        onChange({ ...recurrence, frequency: 'monthly', weekdays: [], cron: undefined })
        return
      case 'custom':
        onChange({ ...recurrence, frequency: 'custom' })
    }
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
