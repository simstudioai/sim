'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CalendarDayCell } from '@/components/emcn/components/calendar/calendar-day-cell'
import { Chip, chipVariants } from '@/components/emcn/components/chip/chip'
import { chipContentLabelClass } from '@/components/emcn/components/chip/chip-chrome'
import { ChipTimePicker } from '@/components/emcn/components/chip-time-picker/chip-time-picker'
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

const DEFAULT_RANGE_START_TIME = '00:00'
const DEFAULT_RANGE_END_TIME = '23:59'

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
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
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

/**
 * Compact label for a date range (e.g. `May 8 - May 12, 2026`). Mirrors
 * {@link formatDateLabel} for the empty/partial cases so triggers can fall back
 * to a placeholder.
 */
export function formatDateRangeLabel(
  start: string | Date | undefined,
  end: string | Date | undefined
): string {
  const startDate = parseDateValue(start)
  const endDate = parseDateValue(end)
  if (!startDate && !endDate) return ''
  if (startDate && !endDate) return formatDateLabel(startDate)
  if (!startDate && endDate) return formatDateLabel(endDate)
  if (!startDate || !endDate) return ''
  const sameYear = startDate.getFullYear() === endDate.getFullYear()
  const startLabel = startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endLabel = endDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `${startLabel} - ${endLabel}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isStrictlyWithin(date: Date, start: Date, end: Date): boolean {
  const time = date.getTime()
  const lo = Math.min(start.getTime(), end.getTime())
  const hi = Math.max(start.getTime(), end.getTime())
  return time > lo && time < hi
}

/** Reads the `HH:mm` slice from a `YYYY-MM-DDTHH:mm` value, or a fallback. */
function extractTime(value: string | Date | undefined, fallback: string): string {
  return typeof value === 'string' && value.includes('T') ? value.slice(11, 16) : fallback
}

/**
 * Orders a start/end pair and serializes the range bounds to the wire format.
 * Without `showTime` the bounds are bare `YYYY-MM-DD` days; with it, the start
 * gains its `HH:mm` and the end is closed at `:59` seconds. On a single day the
 * times are swapped when inverted so the range never ends before it starts.
 */
export function buildRangeBounds(
  start: Date,
  end: Date,
  options: { showTime: boolean; startTime: string; endTime: string }
): { start: string; end: string } {
  const ordered = end < start ? { start: end, end: start } : { start, end }
  const startStr = toDateString(
    ordered.start.getFullYear(),
    ordered.start.getMonth(),
    ordered.start.getDate()
  )
  const endStr = toDateString(
    ordered.end.getFullYear(),
    ordered.end.getMonth(),
    ordered.end.getDate()
  )

  if (!options.showTime) return { start: startStr, end: endStr }

  let startTime = options.startTime
  let endTime = options.endTime
  if (startStr === endStr && startTime > endTime) {
    startTime = options.endTime
    endTime = options.startTime
  }
  return { start: `${startStr}T${startTime}`, end: `${endStr}T${endTime}:59` }
}

interface CalendarBaseProps {
  /** Forwarded to the root grid container. */
  className?: string
}

interface CalendarSingleProps extends CalendarBaseProps {
  mode?: 'single'
  /** Selected date as a `YYYY-MM-DD` string or `Date`. */
  value?: string | Date
  /** Called with the picked date in `YYYY-MM-DD` format. */
  onChange?: (value: string) => void
}

interface CalendarRangeProps extends CalendarBaseProps {
  mode: 'range'
  /** Range start as a `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm`) string or `Date`. */
  startDate?: string | Date
  /** Range end as a `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm`) string or `Date`. */
  endDate?: string | Date
  /** Adds start/end time-of-day inputs; emits `YYYY-MM-DDTHH:mm` bounds. */
  showTime?: boolean
  /** Called on Apply with the ordered range bounds. */
  onRangeChange: (start: string, end: string) => void
  /** Called when the Cancel action is pressed. */
  onCancel?: () => void
  /** Called when the Clear action is pressed. */
  onClear?: () => void
}

export type CalendarProps = CalendarSingleProps | CalendarRangeProps

/**
 * Date grid composed from the chip family — icon-only `Chip` chevrons for month
 * navigation and day cells built on `chipVariants` (`primary` fill when
 * selected, the `border` shadow-ring on today). Pair it with
 * {@link ChipDatePicker} for a chip trigger, or embed it directly.
 *
 * `mode='single'` (default) commits on day click via `onChange`. `mode='range'`
 * stages a start/end selection behind Clear/Cancel/Apply actions (with optional
 * time-of-day inputs) and commits via `onRangeChange`.
 *
 * @example
 * <Calendar value={value} onChange={setValue} />
 *
 * @example
 * <Calendar mode='range' startDate={from} endDate={to} showTime onRangeChange={apply} />
 */
export function Calendar(props: CalendarProps) {
  if (props.mode === 'range') return <RangeCalendarView {...props} />
  return <SingleCalendarView {...props} />
}

function useCalendarView(seed: Date | null) {
  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState(() => {
    const base = seed ?? today
    return { month: base.getMonth(), year: base.getFullYear() }
  })

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

  const cells = useMemo<(number | null)[]>(() => {
    const leading = getFirstDayOfMonth(view.year, view.month)
    const total = getDaysInMonth(view.year, view.month)
    const result: (number | null)[] = []
    for (let i = 0; i < leading; i++) result.push(null)
    for (let day = 1; day <= total; day++) result.push(day)
    return result
  }, [view])

  return { today, view, setView, goToPrevMonth, goToNextMonth, cells }
}

function CalendarHeader({
  month,
  year,
  onPrev,
  onNext,
}: {
  month: number
  year: number
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className='flex items-center justify-between pb-1'>
      <Chip leftIcon={ChevronLeft} aria-label='Previous month' onClick={onPrev} />
      <span className={chipContentLabelClass}>
        {MONTHS[month]} {year}
      </span>
      <Chip rightIcon={ChevronRight} aria-label='Next month' onClick={onNext} />
    </div>
  )
}

function WeekdayRow() {
  return (
    <div className='grid grid-cols-7'>
      {WEEKDAYS.map((weekday) => (
        <div
          key={weekday}
          className='flex h-[28px] items-center justify-center text-[var(--text-muted)] text-caption'
        >
          {weekday}
        </div>
      ))}
    </div>
  )
}

function SingleCalendarView({ value, onChange, className }: CalendarSingleProps) {
  const selected = useMemo(() => parseDateValue(value), [value])
  const { today, view, setView, goToPrevMonth, goToNextMonth, cells } = useCalendarView(selected)

  useEffect(() => {
    if (selected) setView({ month: selected.getMonth(), year: selected.getFullYear() })
  }, [selected, setView])

  const selectDay = (day: number) => onChange?.(toDateString(view.year, view.month, day))

  const goToToday = () => {
    setView({ month: today.getMonth(), year: today.getFullYear() })
    onChange?.(toDateString(today.getFullYear(), today.getMonth(), today.getDate()))
  }

  return (
    <div className={cn('flex w-[256px] flex-col p-2', className)}>
      <CalendarHeader
        month={view.month}
        year={view.year}
        onPrev={goToPrevMonth}
        onNext={goToNextMonth}
      />
      <WeekdayRow />

      <div className='grid grid-cols-7'>
        {cells.map((day, index) => {
          if (day === null) return <div key={`empty-${index}`} className='h-[34px]' />

          const cellDate = new Date(view.year, view.month, day)
          const isSelected = selected ? isSameDay(cellDate, selected) : false
          const isToday = isSameDay(cellDate, today)

          return (
            <div key={day} className='flex h-[34px] items-center justify-center'>
              <CalendarDayCell selected={isSelected} today={isToday} onClick={() => selectDay(day)}>
                {day}
              </CalendarDayCell>
            </div>
          )
        })}
      </div>

      <button
        type='button'
        onClick={goToToday}
        className={cn(
          chipVariants({ variant: 'filled', fullWidth: true, flush: true }),
          'mt-1 justify-center'
        )}
      >
        <span className={chipContentLabelClass}>Today</span>
      </button>
    </div>
  )
}

function RangeCalendarView({
  startDate,
  endDate,
  showTime = false,
  onRangeChange,
  onCancel,
  onClear,
  className,
}: CalendarRangeProps) {
  const seededStart = useMemo(() => parseDateValue(startDate), [startDate])
  const { today, view, setView, goToPrevMonth, goToNextMonth, cells } = useCalendarView(seededStart)

  const [rangeStart, setRangeStart] = useState<Date | null>(seededStart)
  const [rangeEnd, setRangeEnd] = useState<Date | null>(() => parseDateValue(endDate))
  const [selectingEnd, setSelectingEnd] = useState(false)
  const [startTime, setStartTime] = useState(() => extractTime(startDate, DEFAULT_RANGE_START_TIME))
  const [endTime, setEndTime] = useState(() => extractTime(endDate, DEFAULT_RANGE_END_TIME))

  /**
   * Resync the staged selection when the bound props change (e.g. a new range
   * applied elsewhere) so the grid never lingers on a stale draft. Closing the
   * popover unmounts this view, so a fresh open already re-seeds from props;
   * this render-phase reset covers prop changes while it stays mounted.
   */
  const seedKey = `${seededStart?.getTime() ?? ''}|${parseDateValue(endDate)?.getTime() ?? ''}|${extractTime(startDate, DEFAULT_RANGE_START_TIME)}|${extractTime(endDate, DEFAULT_RANGE_END_TIME)}`
  const [prevSeedKey, setPrevSeedKey] = useState(seedKey)
  if (seedKey !== prevSeedKey) {
    setPrevSeedKey(seedKey)
    setRangeStart(seededStart)
    setRangeEnd(parseDateValue(endDate))
    setSelectingEnd(false)
    setStartTime(extractTime(startDate, DEFAULT_RANGE_START_TIME))
    setEndTime(extractTime(endDate, DEFAULT_RANGE_END_TIME))
    if (seededStart) setView({ month: seededStart.getMonth(), year: seededStart.getFullYear() })
  }

  const pickDay = (day: number) => {
    const date = new Date(view.year, view.month, day)
    if (!selectingEnd || !rangeStart) {
      setRangeStart(date)
      setRangeEnd(null)
      setSelectingEnd(true)
      return
    }
    if (date < rangeStart) {
      setRangeEnd(rangeStart)
      setRangeStart(date)
    } else {
      setRangeEnd(date)
    }
    setSelectingEnd(false)
  }

  const clear = () => {
    setRangeStart(null)
    setRangeEnd(null)
    setSelectingEnd(false)
    onClear?.()
  }

  const apply = () => {
    if (!rangeStart) return
    const bounds = buildRangeBounds(rangeStart, rangeEnd ?? rangeStart, {
      showTime,
      startTime,
      endTime,
    })
    onRangeChange(bounds.start, bounds.end)
  }

  return (
    <div className={cn('flex w-[256px] flex-col p-2', className)}>
      <CalendarHeader
        month={view.month}
        year={view.year}
        onPrev={goToPrevMonth}
        onNext={goToNextMonth}
      />
      <WeekdayRow />

      <div className='grid grid-cols-7'>
        {cells.map((day, index) => {
          if (day === null) return <div key={`empty-${index}`} className='h-[34px]' />

          const cellDate = new Date(view.year, view.month, day)
          const isStart = rangeStart ? isSameDay(cellDate, rangeStart) : false
          const isEnd = rangeEnd ? isSameDay(cellDate, rangeEnd) : false
          const within =
            rangeStart && rangeEnd ? isStrictlyWithin(cellDate, rangeStart, rangeEnd) : false
          const hasBand = (within || isStart || isEnd) && Boolean(rangeStart && rangeEnd)

          return (
            <div
              key={day}
              className={cn(
                'relative flex h-[34px] items-center justify-center',
                hasBand &&
                  'before:absolute before:inset-y-[2px] before:right-0 before:left-0 before:bg-[var(--surface-active)]',
                hasBand && isStart && 'before:left-[3px] before:rounded-l-[8px]',
                hasBand && isEnd && 'before:right-[3px] before:rounded-r-[8px]'
              )}
            >
              <CalendarDayCell
                selected={isStart || isEnd}
                today={isSameDay(cellDate, today)}
                className='relative z-[1]'
                onClick={() => pickDay(day)}
              >
                {day}
              </CalendarDayCell>
            </div>
          )
        })}
      </div>

      {showTime && (
        <div className='mt-1 flex items-center gap-2'>
          <ChipTimePicker value={startTime} onChange={setStartTime} fullWidth flush />
          <span className='shrink-0 text-[var(--text-muted)] text-caption'>to</span>
          <ChipTimePicker value={endTime} onChange={setEndTime} fullWidth flush />
        </div>
      )}

      <div className='mt-1 flex items-center justify-between gap-2'>
        <Chip onClick={clear} disabled={!rangeStart && !rangeEnd}>
          Clear
        </Chip>
        <div className='flex items-center gap-2'>
          <Chip variant='border' onClick={() => onCancel?.()}>
            Cancel
          </Chip>
          <Chip variant='primary' onClick={apply} disabled={!rangeStart}>
            Apply
          </Chip>
        </div>
      </div>
    </div>
  )
}
