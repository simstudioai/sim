'use client'

import { format } from 'date-fns'
import { ChipDatePicker, ChipModalField, Switch } from '@/components/emcn'
import type { Recurrence } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'

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
   * recurrence shape (cadence, end, and a passed-through `custom` cron) on the
   * object and only sets `frequency: 'once'` — the wire ignores everything but
   * `frequency` for a one-time task — so toggling back on restores `custom`
   * rather than silently rewriting a conversationally-authored cron to `daily`.
   */
  const handleRecurringToggle = (checked: boolean) => {
    if (!checked) {
      onChange({ ...recurrence, frequency: 'once' })
      return
    }
    onChange({
      ...recurrence,
      frequency: recurrence.cron ? 'custom' : DEFAULT_RECURRING_FREQUENCY,
      weekdays: [],
    })
  }

  const handleFrequencyChange = (value: string) => {
    const option = value as FrequencyOption
    switch (option) {
      case 'daily':
        onChange({ ...recurrence, frequency: 'daily', weekdays: [] })
        return
      case 'weekly':
        onChange({ ...recurrence, frequency: 'weekly', weekdays: [launch.getDay()] })
        return
      case 'weekdays':
        onChange({ ...recurrence, frequency: 'weekly', weekdays: [...WEEKDAY_PRESET] })
        return
      case 'monthly':
        onChange({ ...recurrence, frequency: 'monthly', weekdays: [] })
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
      <div className='h-px bg-[var(--border)]' />
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
