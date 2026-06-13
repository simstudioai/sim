'use client'

import { format } from 'date-fns'
import { ChipDatePicker, ChipDropdown, ChipInput, RefreshCw } from '@/components/emcn'
import type { Recurrence } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'

const WEEKDAY_PRESET = [1, 2, 3, 4, 5]
/** Seed count when the user first chooses "ends after N runs". */
const DEFAULT_END_AFTER_COUNT = 10

/** The frequency presets the dropdown authors, keyed by a synthetic option value. */
type FrequencyOption = 'once' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom'

function isWeekdayPreset(weekdays: number[]): boolean {
  return (
    weekdays.length === WEEKDAY_PRESET.length && WEEKDAY_PRESET.every((d) => weekdays.includes(d))
  )
}

/** Collapses a recurrence into the single dropdown value that represents it. */
function frequencyOptionFor(recurrence: Recurrence): FrequencyOption {
  if (recurrence.frequency === 'weekly')
    return isWeekdayPreset(recurrence.weekdays) ? 'weekdays' : 'weekly'
  return recurrence.frequency
}

interface RecurrenceControlProps {
  recurrence: Recurrence
  onChange: (recurrence: Recurrence) => void
  /** The launch day, so weekly/monthly labels name the weekday and day-of-month. */
  launchDate: string
}

/**
 * The repeat + end controls for a scheduled task, modeled on a calendar app's
 * recurrence row: a frequency preset and — when the task repeats — how it ends
 * (never, on a date, or after N runs).
 */
export function RecurrenceControl({ recurrence, onChange, launchDate }: RecurrenceControlProps) {
  const launch = new Date(`${launchDate}T00:00`)

  const frequencyOptions = [
    { value: 'once', label: 'Once' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: `Weekly on ${format(launch, 'EEE')}` },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'monthly', label: `Monthly on the ${format(launch, 'do')}` },
    ...(recurrence.frequency === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
  ]

  const handleFrequencyChange = (value: string) => {
    const option = value as FrequencyOption
    switch (option) {
      case 'once':
        onChange({ frequency: 'once', weekdays: [], end: { type: 'never' } })
        return
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
    <div className='flex flex-wrap items-center gap-2'>
      <ChipDropdown
        leftIcon={RefreshCw}
        value={frequencyOptionFor(recurrence)}
        options={frequencyOptions}
        onChange={handleFrequencyChange}
        matchTriggerWidth={false}
        flush
      />

      {recurrence.frequency !== 'once' && (
        <ChipDropdown
          value={recurrence.end.type}
          options={[
            { value: 'never', label: 'No end' },
            { value: 'on', label: 'Ends on' },
            { value: 'after', label: 'Ends after' },
          ]}
          onChange={handleEndChange}
          matchTriggerWidth={false}
          flush
        />
      )}

      {recurrence.frequency !== 'once' && recurrence.end.type === 'on' && (
        <ChipDatePicker
          value={recurrence.end.date}
          onChange={(date) => onChange({ ...recurrence, end: { type: 'on', date } })}
          flush
        />
      )}

      {recurrence.frequency !== 'once' && recurrence.end.type === 'after' && (
        <ChipInput
          className='w-[120px]'
          inputMode='numeric'
          value={String(recurrence.end.count)}
          onChange={(event) => {
            const count = Math.max(1, Math.floor(Number(event.target.value) || 1))
            onChange({ ...recurrence, end: { type: 'after', count } })
          }}
          endAdornment={<span className='text-[var(--text-muted)] text-caption'>runs</span>}
        />
      )}
    </div>
  )
}
