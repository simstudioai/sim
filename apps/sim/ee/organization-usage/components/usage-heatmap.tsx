'use client'

import { useRef, useState } from 'react'
import { cn, scrollFadeAttributes, scrollFadeXClass, Tooltip, useScrollEdges } from '@sim/emcn'
import type { OrganizationUsageCalendar } from '@/lib/api/contracts/organization-usage'
import { formatApportionedCreditCost } from '@/lib/billing/credits/conversion'
import { USAGE_PALETTE_CLASS } from '@/ee/organization-usage/constants'

const LEVEL_CLASSES = [
  'bg-[var(--surface-active)]',
  'bg-[color-mix(in_srgb,var(--usage-workflow)_25%,var(--surface-2))]',
  'bg-[color-mix(in_srgb,var(--usage-workflow)_50%,var(--surface-2))]',
  'bg-[color-mix(in_srgb,var(--usage-workflow)_75%,var(--surface-2))]',
  'bg-[var(--usage-workflow)]',
] as const
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] as const
const ARROW_OFFSETS: Record<string, number> = {
  ArrowLeft: -7,
  ArrowRight: 7,
  ArrowUp: -1,
  ArrowDown: 1,
}
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' })

interface UsageHeatmapProps {
  days: OrganizationUsageCalendar['days']
}

function formatDayUsage(day: OrganizationUsageCalendar['days'][number]) {
  return `${formatApportionedCreditCost(day.credits, day.hasCost)} on ${DAY_FORMAT.format(new Date(`${day.date}T00:00:00Z`))}`
}

/** Calendar dates stay in UTC for layout; they already describe the viewer's local days. */
export function UsageHeatmap({ days }: UsageHeatmapProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef, { axis: 'x' })
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const selectedDay = days.find((day) => day.date === selectedDate)
  const first = days[0]
  if (!first) return null
  const firstDate = new Date(`${first.date}T00:00:00Z`)
  const offset = (firstDate.getUTCDay() + 6) % 7
  const weeks = Math.ceil((offset + days.length) / 7)
  const peak = Math.max(...days.map((day) => day.credits), 1)
  const total = days.reduce((sum, day) => sum + day.credits, 0)
  const hasCost = days.some((day) => day.hasCost)
  const months = days.flatMap((day, index) => {
    const date = new Date(`${day.date}T00:00:00Z`)
    if (date.getUTCDate() !== 1) return []
    const column = Math.floor((index + offset) / 7)
    if (column > weeks - 3) return []
    return [{ date: day.date, column, label: MONTH_FORMAT.format(date) }]
  })

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', USAGE_PALETTE_CLASS)}>
      <div
        ref={scrollRef}
        className={cn('overflow-x-auto pb-1', scrollFadeXClass)}
        {...scrollFadeAttributes(edges)}
      >
        <div className='min-w-[660px] max-w-[860px] p-1'>
          <div
            className='mb-2 ml-8 grid gap-[3px] text-[var(--text-muted)] text-small'
            style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
            aria-hidden='true'
          >
            {months.map((month) => (
              <span key={month.date} style={{ gridColumn: `${month.column + 1} / span 3` }}>
                {month.label}
              </span>
            ))}
          </div>
          <div className='relative'>
            <div
              className='absolute inset-y-0 left-0 grid w-6 grid-rows-7 gap-[3px] text-[var(--text-muted)] text-small'
              aria-hidden='true'
            >
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index} className='flex items-center'>
                  {label}
                </span>
              ))}
            </div>
            <div
              ref={gridRef}
              role='group'
              aria-label='Daily credit usage. Use arrow keys to move between days, Home for the first day, or End for today.'
              className='ml-8 grid gap-[3px]'
              style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
            >
              {days.map((day, index) => {
                const position = index + offset
                const level = day.hasCost
                  ? Math.max(1, Math.min(4, Math.ceil(Math.sqrt(day.credits / peak) * 4)))
                  : 0
                const label = formatDayUsage(day)
                return (
                  <Tooltip.Root key={day.date}>
                    <Tooltip.Trigger asChild>
                      <button
                        type='button'
                        aria-label={label}
                        aria-pressed={day.date === selectedDate}
                        data-day-index={index}
                        tabIndex={index === (focusedIndex ?? days.length - 1) ? 0 : -1}
                        className={cn(
                          'aspect-square rounded-[3px] outline-offset-2 hover:outline hover:outline-1 hover:outline-[var(--text-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]',
                          LEVEL_CLASSES[level],
                          day.date === selectedDate &&
                            'outline outline-2 outline-[var(--text-primary)]'
                        )}
                        style={{
                          gridColumn: Math.floor(position / 7) + 1,
                          gridRow: (position % 7) + 1,
                        }}
                        onClick={() =>
                          setSelectedDate((current) => (current === day.date ? null : day.date))
                        }
                        onFocus={() => setFocusedIndex(index)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && selectedDate) {
                            event.preventDefault()
                            setSelectedDate(null)
                            return
                          }
                          const delta = ARROW_OFFSETS[event.key]
                          const next =
                            event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? days.length - 1
                                : delta === undefined
                                  ? null
                                  : Math.max(0, Math.min(days.length - 1, index + delta))
                          if (next === null) return
                          event.preventDefault()
                          gridRef.current
                            ?.querySelector<HTMLButtonElement>(`[data-day-index="${next}"]`)
                            ?.focus()
                        }}
                      />
                    </Tooltip.Trigger>
                    <Tooltip.Content>{label}</Tooltip.Content>
                  </Tooltip.Root>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2 text-[var(--text-muted)] text-small'>
        <span aria-live='polite'>
          {selectedDay
            ? formatDayUsage(selectedDay)
            : `${formatApportionedCreditCost(total, hasCost)} in the last 365 days`}
        </span>
        <div
          className='flex items-center gap-1'
          aria-label='Color intensity: less to more daily usage'
        >
          <span className='mr-1'>Less</span>
          {LEVEL_CLASSES.map((className) => (
            <span
              key={className}
              className={cn('size-3 rounded-[3px]', className)}
              aria-hidden='true'
            />
          ))}
          <span className='ml-1'>More</span>
        </div>
      </div>
    </div>
  )
}
