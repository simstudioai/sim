'use client'

import { ChipInput, Combobox } from '@sim/emcn'
import { Clock } from '@sim/emcn/icons'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

const FREQUENCIES = [
  { value: 'minutes', label: 'Every X Minutes' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom (Cron)' },
]

/** ScheduleBlock's real fields and display labels, using the editor's native controls. */
export function WorkflowSchedulePreview() {
  return (
    <div
      aria-hidden='true'
      inert
      data-workflow-schedule-preview
      className='pointer-events-none absolute @max-[400px]:top-8 top-12 left-6 w-[390px] select-none overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-small'
    >
      <MenuPreviewHeader icon={Clock} title='Weekday digest' />
      <div className='space-y-4 p-4'>
        <div className='space-y-1.5'>
          <p className='text-[var(--text-primary)]'>Run frequency</p>
          <Combobox
            options={FREQUENCIES}
            value='custom'
            onChange={() => {}}
            editable={false}
            searchable={false}
          />
        </div>
        <div className='space-y-1.5'>
          <p className='text-[var(--text-primary)]'>Cron expression</p>
          <ChipInput
            aria-label='Cron expression'
            value='0 9 * * 1-5'
            readOnly
            inputClassName='font-mono'
          />
        </div>
        <div className='space-y-1.5'>
          <p className='text-[var(--text-primary)]'>Timezone</p>
          <Combobox
            options={[{ value: 'America/Los_Angeles', label: 'US Pacific (UTC-8)' }]}
            value='America/Los_Angeles'
            onChange={() => {}}
            editable={false}
            searchable
          />
        </div>
        <p className='text-[var(--text-tertiary)] text-caption'>
          At 9:00 AM, Monday through Friday
        </p>
      </div>
    </div>
  )
}
