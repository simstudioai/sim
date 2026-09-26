'use client'

import { useRef, useState } from 'react'
import { Calendar, ChipCombobox, Popover, PopoverAnchor, PopoverContent, toast } from '@sim/emcn'
import { formatDateShort } from '@/lib/core/utils/date-display'
import { getSearchStatsRangeError, type SEARCH_STATS_PERIODS } from '@/lib/knowledge/search/stats'

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '3d', label: 'Past 3 days' },
  { value: '7d', label: 'Past 7 days' },
  { value: '14d', label: 'Past 14 days' },
  { value: '30d', label: 'Past 30 days' },
  { value: '90d', label: 'Past 90 days' },
  { value: 'custom', label: 'Custom range' },
] satisfies { value: (typeof SEARCH_STATS_PERIODS)[number]; label: string }[]

interface SearchStatsPeriodSelection {
  period: (typeof SEARCH_STATS_PERIODS)[number]
  startDate: string | null
  endDate: string | null
}

interface OrganizationSearchStatsPeriodProps extends SearchStatsPeriodSelection {
  onChange: (selection: SearchStatsPeriodSelection) => void
}

export function OrganizationSearchStatsPeriod({
  period,
  startDate,
  endDate,
  onChange,
}: OrganizationSearchStatsPeriodProps) {
  const triggerContainerRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const label =
    period === 'custom' && startDate && endDate && !getSearchStatsRangeError({ startDate, endDate })
      ? `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`
      : PERIOD_OPTIONS.find((option) => option.value === period)?.label

  return (
    <div ref={triggerContainerRef} className='relative shrink-0'>
      <ChipCombobox
        aria-label='Stats period'
        options={PERIOD_OPTIONS}
        value={period}
        overlayLabel={label}
        align='end'
        onChange={(value) => {
          const selected = PERIOD_OPTIONS.find((option) => option.value === value)
          if (!selected) return
          if (selected.value === 'custom') setCalendarOpen(true)
          else onChange({ period: selected.value, startDate: null, endDate: null })
        }}
      />
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverAnchor className='pointer-events-none absolute inset-0' />
        <PopoverContent
          ref={calendarRef}
          tabIndex={-1}
          align='end'
          sideOffset={4}
          className='w-auto p-0'
          onOpenAutoFocus={() => calendarRef.current?.focus()}
          onCloseAutoFocus={() =>
            triggerContainerRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus()
          }
        >
          <Calendar
            mode='range'
            startDate={startDate ?? undefined}
            endDate={endDate ?? undefined}
            onCancel={() => setCalendarOpen(false)}
            onRangeChange={(start, end) => {
              const error = getSearchStatsRangeError({ startDate: start, endDate: end })
              if (error) {
                toast.error(error)
                return
              }
              onChange({ period: 'custom', startDate: start, endDate: end })
              setCalendarOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
