'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

/**
 * Serializes a calendar cell to the `YYYY-MM-DD` wire format used across the
 * date filters. Built from local Y/M/D parts so there is no UTC offset shift.
 */
function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

/**
 * Parses a `YYYY-MM-DD` string (or `Date`) into a local `Date`. `YYYY-MM-DD`
 * is parsed as local time to avoid the off-by-one day that `new Date('2026-05-08')`
 * (UTC midnight) produces in negative-offset timezones.
 */
export function parseDateValue(value: string | Date | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Human-readable label for a date value (e.g. `May 8, 2026`). Returns an empty
 * string when there is no parseable date — callers fall back to a placeholder.
 */
export function formatDateLabel(value: string | Date | undefined): string {
  const date = parseDateValue(value)
  if (!date) return ''
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export interface CalendarProps {
  /** Selected date as a `YYYY-MM-DD` string or `Date`. */
  value?: string | Date
  /** Called with the picked date in `YYYY-MM-DD` format. */
  onChange?: (value: string) => void
  /** Forwarded to the root grid container. */
  className?: string
}

/**
 * Single-month date grid aligned with the chip family — `rounded-lg` day cells,
 * `--surface-active` hover, and a `primary`-chip fill on the selected day. Pair
 * it with {@link ChipDatePicker} for a chip trigger, or embed it directly.
 *
 * @example
 * <Calendar value={value} onChange={setValue} />
 */
export function Calendar({ value, onChange, className }: CalendarProps) {
  const selected = useMemo(() => parseDateValue(value), [value])
  const today = useMemo(() => new Date(), [])

  const [view, setView] = useState(() => {
    const base = selected ?? today
    return { month: base.getMonth(), year: base.getFullYear() }
  })

  useEffect(() => {
    if (selected) {
      setView({ month: selected.getMonth(), year: selected.getFullYear() })
    }
  }, [selected])

  const cells = useMemo<(number | null)[]>(() => {
    const leading = getFirstDayOfMonth(view.year, view.month)
    const total = getDaysInMonth(view.year, view.month)
    const result: (number | null)[] = []
    for (let i = 0; i < leading; i++) result.push(null)
    for (let day = 1; day <= total; day++) result.push(day)
    return result
  }, [view])

  const goToPrevMonth = () =>
    setView((prev) =>
      prev.month === 0
        ? { month: 11, year: prev.year - 1 }
        : { month: prev.month - 1, year: prev.year }
    )

  const goToNextMonth = () =>
    setView((prev) =>
      prev.month === 11
        ? { month: 0, year: prev.year + 1 }
        : { month: prev.month + 1, year: prev.year }
    )

  const selectDay = (day: number) => onChange?.(toDateString(view.year, view.month, day))

  const goToToday = () => {
    setView({ month: today.getMonth(), year: today.getFullYear() })
    onChange?.(toDateString(today.getFullYear(), today.getMonth(), today.getDate()))
  }

  return (
    <div className={cn('flex w-[256px] flex-col p-2', className)}>
      <div className='flex items-center justify-between px-1 pb-1'>
        <button
          type='button'
          aria-label='Previous month'
          onClick={goToPrevMonth}
          className='flex size-[28px] items-center justify-center rounded-lg text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
        >
          <ChevronLeft className='size-4' />
        </button>
        <span className='font-medium text-[var(--text-primary)] text-sm'>
          {MONTHS[view.month]} {view.year}
        </span>
        <button
          type='button'
          aria-label='Next month'
          onClick={goToNextMonth}
          className='flex size-[28px] items-center justify-center rounded-lg text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
        >
          <ChevronRight className='size-4' />
        </button>
      </div>

      <div className='grid grid-cols-7'>
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className='flex h-[28px] items-center justify-center text-[var(--text-muted)] text-xs'
          >
            {weekday}
          </div>
        ))}
      </div>

      <div className='grid grid-cols-7'>
        {cells.map((day, index) => {
          if (day === null) return <div key={`empty-${index}`} className='h-[34px]' />

          const cellDate = new Date(view.year, view.month, day)
          const isSelected = selected ? isSameDay(cellDate, selected) : false
          const isToday = isSameDay(cellDate, today)

          return (
            <div key={day} className='flex h-[34px] items-center justify-center'>
              <button
                type='button'
                onClick={() => selectDay(day)}
                className={cn(
                  'flex size-[30px] items-center justify-center rounded-lg text-sm transition-colors',
                  isSelected
                    ? 'bg-[var(--text-primary)] text-[var(--text-inverse)] dark:bg-white dark:text-[var(--bg)]'
                    : isToday
                      ? 'font-medium text-[var(--text-primary)] ring-1 ring-[var(--border-1)] ring-inset hover-hover:bg-[var(--surface-active)]'
                      : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-active)]'
                )}
              >
                {day}
              </button>
            </div>
          )
        })}
      </div>

      <button
        type='button'
        onClick={goToToday}
        className='mt-1 flex h-[30px] w-full items-center justify-center rounded-lg text-[var(--text-secondary)] text-sm transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
      >
        Today
      </button>
    </div>
  )
}
