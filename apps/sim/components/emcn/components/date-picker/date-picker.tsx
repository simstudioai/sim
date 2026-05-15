/**
 * DatePicker component with calendar dropdown for date selection.
 * Uses Radix UI Popover primitives for positioning and accessibility.
 *
 * @example
 * ```tsx
 * // Basic single date picker
 * <DatePicker
 *   value={date}
 *   onChange={(dateString) => setDate(dateString)}
 *   placeholder="Select date"
 * />
 *
 * // Range date picker
 * <DatePicker
 *   mode="range"
 *   startDate={startDate}
 *   endDate={endDate}
 *   onRangeChange={(start, end) => handleRange(start, end)}
 *   placeholder="Select date range"
 * />
 * ```
 */

'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/emcn/components/button/button'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/emcn/components/popover/popover'
import { TimePicker } from '@/components/emcn/components/time-picker/time-picker'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the date picker trigger button.
 * Matches the combobox and input styling patterns.
 */
const datePickerVariants = cva(
  'flex w-full rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-sans font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
      },
      size: {
        default: 'py-1.5 text-sm',
        sm: 'py-[5px] text-caption',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

/** Base props shared by both single and range modes */
interface DatePickerBaseProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>,
    VariantProps<typeof datePickerVariants> {
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Size variant */
  size?: 'default' | 'sm'
  /** Whether to show the trigger button (set to false for inline/controlled usage) */
  showTrigger?: boolean
  /** Controlled open state */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Render calendar inline without popover (for use inside modals) */
  inline?: boolean
}

/** Props for single date mode */
interface DatePickerSingleProps extends DatePickerBaseProps {
  /** Selection mode */
  mode?: 'single'
  /** Current selected date value (YYYY-MM-DD string or Date) */
  value?: string | Date
  /** Callback when date changes, returns YYYY-MM-DD format */
  onChange?: (value: string) => void
  /** Not used in single mode */
  startDate?: never
  /** Not used in single mode */
  endDate?: never
  /** Not used in single mode */
  onRangeChange?: never
  /** Not used in single mode */
  onCancel?: never
  /** Not used in single mode */
  onClear?: never
  /** Not used in single mode */
  showTime?: never
}

/** Props for range date mode */
interface DatePickerRangeProps extends DatePickerBaseProps {
  /** Selection mode */
  mode: 'range'
  /** Start date for range mode (YYYY-MM-DD or YYYY-MM-DDTHH:mm string or Date) */
  startDate?: string | Date
  /** End date for range mode (YYYY-MM-DD or YYYY-MM-DDTHH:mm string or Date) */
  endDate?: string | Date
  /** Callback when date range is applied — returns YYYY-MM-DD or YYYY-MM-DDTHH:mm depending on showTime */
  onRangeChange?: (startDate: string, endDate: string) => void
  /** Callback when range selection is cancelled */
  onCancel?: () => void
  /** Callback when range is cleared */
  onClear?: () => void
  /** Whether to show time inputs for precise range selection */
  showTime?: boolean
  /** Not used in range mode */
  value?: never
  /** Not used in range mode */
  onChange?: never
}

export type DatePickerProps = DatePickerSingleProps | DatePickerRangeProps

/**
 * Flattened props type for safe destructuring.
 * The discriminated union prevents direct destructuring of mode-specific props,
 * so we cast to this merged shape after the forwardRef boundary.
 */
type FlatDatePickerProps = DatePickerBaseProps & {
  mode?: 'single' | 'range'
  value?: string | Date
  onChange?: (value: string) => void
  startDate?: string | Date
  endDate?: string | Date
  onRangeChange?: (startDate: string, endDate: string) => void
  onCancel?: () => void
  onClear?: () => void
  showTime?: boolean
}

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
]

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

function formatDateForDisplay(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateRangeForDisplay(start: Date | null, end: Date | null): string {
  if (!start && !end) return ''
  if (start && !end) return formatDateForDisplay(start)
  if (!start && end) return formatDateForDisplay(end)
  if (start && end) {
    const startStr = `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}`
    const endStr =
      start.getFullYear() === end.getFullYear()
        ? `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}`
        : `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
    return `${startStr} - ${endStr}${start.getFullYear() !== end.getFullYear() ? '' : `, ${start.getFullYear()}`}`
  }
  return ''
}

function isDateInRange(date: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false
  const time = date.getTime()
  const startTime = Math.min(start.getTime(), end.getTime())
  const endTime = Math.max(start.getTime(), end.getTime())
  return time >= startTime && time <= endTime
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

function formatDateAsString(year: number, month: number, day: number): string {
  const m = (month + 1).toString().padStart(2, '0')
  const d = day.toString().padStart(2, '0')
  return `${year}-${m}-${d}`
}

/**
 * Parses a string or Date value into a Date object.
 * YYYY-MM-DD strings are parsed as local time to avoid UTC offset shifts.
 */
function parseDate(value: string | Date | undefined): Date | null {
  if (!value) return null

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value
  }

  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number)
      return new Date(year, month - 1, day)
    }

    if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return null
      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    }

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

interface CalendarMonthProps {
  viewMonth: number
  viewYear: number
  selectedDate?: Date | null
  rangeStart?: Date | null
  rangeEnd?: Date | null
  hoverDate?: Date | null
  isRangeMode?: boolean
  onSelectDate: (day: number) => void
  onHoverDate?: (day: number | null) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  showNavigation?: 'left' | 'right' | 'both'
}

function CalendarMonth({
  viewMonth,
  viewYear,
  selectedDate,
  rangeStart,
  rangeEnd,
  hoverDate: _hoverDate,
  isRangeMode,
  onSelectDate,
  onHoverDate,
  onPrevMonth,
  onNextMonth,
  showNavigation = 'both',
}: CalendarMonthProps) {
  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDayOfMonth = getFirstDayOfMonth(viewYear, viewMonth)

  const calendarDays = React.useMemo(() => {
    const days: (number | null)[] = []
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null)
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }
    return days
  }, [firstDayOfMonth, daysInMonth])

  const isToday = React.useCallback(
    (day: number) => {
      const today = new Date()
      return (
        today.getDate() === day &&
        today.getMonth() === viewMonth &&
        today.getFullYear() === viewYear
      )
    },
    [viewMonth, viewYear]
  )

  const isSelected = React.useCallback(
    (day: number) => {
      if (!selectedDate) return false
      return (
        selectedDate.getDate() === day &&
        selectedDate.getMonth() === viewMonth &&
        selectedDate.getFullYear() === viewYear
      )
    },
    [selectedDate, viewMonth, viewYear]
  )

  const isRangeStart = React.useCallback(
    (day: number) => {
      if (!rangeStart) return false
      return (
        rangeStart.getDate() === day &&
        rangeStart.getMonth() === viewMonth &&
        rangeStart.getFullYear() === viewYear
      )
    },
    [rangeStart, viewMonth, viewYear]
  )

  const isRangeEnd = React.useCallback(
    (day: number) => {
      if (!rangeEnd) return false
      return (
        rangeEnd.getDate() === day &&
        rangeEnd.getMonth() === viewMonth &&
        rangeEnd.getFullYear() === viewYear
      )
    },
    [rangeEnd, viewMonth, viewYear]
  )

  const isInRange = React.useCallback(
    (day: number) => {
      if (!isRangeMode || !rangeStart || !rangeEnd) return false
      const date = new Date(viewYear, viewMonth, day)
      return (
        isDateInRange(date, rangeStart, rangeEnd) &&
        !isSameDay(date, rangeStart) &&
        !isSameDay(date, rangeEnd)
      )
    },
    [isRangeMode, rangeStart, rangeEnd, viewMonth, viewYear]
  )

  return (
    <div className='flex flex-col'>
      {/* Calendar Header */}
      <div className='flex items-center justify-between border-[var(--border-1)] border-b px-3 py-2.5'>
        {showNavigation === 'left' || showNavigation === 'both' ? (
          <button
            type='button'
            className='flex size-[24px] items-center justify-center rounded-sm text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
            onClick={onPrevMonth}
          >
            <ChevronLeft className='size-4' />
          </button>
        ) : (
          <div className='size-[24px]' />
        )}
        <span className='font-medium text-[var(--text-primary)] text-small'>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        {showNavigation === 'right' || showNavigation === 'both' ? (
          <button
            type='button'
            className='flex size-[24px] items-center justify-center rounded-sm text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
            onClick={onNextMonth}
          >
            <ChevronRight className='size-4' />
          </button>
        ) : (
          <div className='size-[24px]' />
        )}
      </div>

      {/* Day Headers */}
      <div className='grid grid-cols-7 px-2 pt-2'>
        {DAYS.map((day) => (
          <div
            key={day}
            className='flex h-[28px] items-center justify-center text-[var(--text-muted)] text-xs'
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className='grid grid-cols-7 px-2 pb-2'>
        {calendarDays.map((day, index) => {
          const inRange = day !== null && isInRange(day)
          const isStart = day !== null && isRangeStart(day)
          const isEnd = day !== null && isRangeEnd(day)
          const hasRangeHighlight = inRange || isStart || isEnd

          return (
            <div
              key={index}
              className={cn(
                'relative flex h-[32px] items-center justify-center',
                isRangeMode &&
                  hasRangeHighlight &&
                  'before:absolute before:inset-y-[2px] before:right-0 before:left-0 before:bg-[#60a5fa]/25',
                isRangeMode && isStart && 'before:left-[2px] before:rounded-l-[4px]',
                isRangeMode && isEnd && 'before:right-[2px] before:rounded-r-[4px]',
                isRangeMode && isStart && !rangeEnd && 'before:right-[2px] before:rounded-r-[4px]',
                isRangeMode && isStart && isEnd && 'before:rounded-sm'
              )}
            >
              {day !== null && (
                <button
                  type='button'
                  className={cn(
                    'relative z-10 flex h-[28px] w-[28px] items-center justify-center rounded-sm text-caption transition-colors',
                    isRangeMode
                      ? isStart || isEnd
                        ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                        : inRange
                          ? 'text-[var(--text-primary)] hover-hover:bg-[#60a5fa]/40'
                          : 'text-[var(--text-primary)] hover-hover:bg-[var(--surface-5)]'
                      : isSelected(day)
                        ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                        : isToday(day)
                          ? 'bg-[var(--surface-5)] text-[var(--text-primary)]'
                          : 'text-[var(--text-primary)] hover-hover:bg-[var(--surface-5)]'
                  )}
                  onClick={() => onSelectDate(day)}
                  onMouseEnter={() => onHoverDate?.(day)}
                  onMouseLeave={() => onHoverDate?.(null)}
                >
                  {day}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * DatePicker component matching emcn design patterns.
 * Provides a calendar dropdown for date selection.
 * Supports both single date and date range modes.
 */
const DatePicker = React.forwardRef<HTMLDivElement, DatePickerProps>((props, ref) => {
  const {
    className,
    variant,
    size,
    placeholder: placeholderProp,
    disabled,
    showTrigger = true,
    open: controlledOpen,
    onOpenChange,
    inline = false,
    mode,
    value,
    onChange,
    startDate,
    endDate,
    onRangeChange,
    onCancel,
    onClear,
    showTime = false,
    ...htmlProps
  } = props as FlatDatePickerProps

  const isRangeMode = mode === 'range'
  const placeholder = placeholderProp ?? (isRangeMode ? 'Select date range' : 'Select date')

  const isControlled = controlledOpen !== undefined
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )

  const selectedDate = !isRangeMode ? parseDate(value) : null

  const [rangeStart, setRangeStart] = React.useState<Date | null>(() =>
    isRangeMode ? parseDate(startDate) : null
  )
  const [rangeEnd, setRangeEnd] = React.useState<Date | null>(() =>
    isRangeMode ? parseDate(endDate) : null
  )
  const [hoverDate, setHoverDate] = React.useState<Date | null>(null)
  const [selectingEnd, setSelectingEnd] = React.useState(false)
  const [startTime, setStartTime] = React.useState('00:00')
  const [endTime, setEndTime] = React.useState('23:59')

  const [viewMonth, setViewMonth] = React.useState(() => {
    const d = selectedDate ?? (isRangeMode ? parseDate(startDate) : null) ?? new Date()
    return d.getMonth()
  })
  const [viewYear, setViewYear] = React.useState(() => {
    const d = selectedDate ?? (isRangeMode ? parseDate(startDate) : null) ?? new Date()
    return d.getFullYear()
  })

  const rightViewMonth = viewMonth === 11 ? 0 : viewMonth + 1
  const rightViewYear = viewMonth === 11 ? viewYear + 1 : viewYear

  // Sync range state when the popover opens with the current prop values.
  // Deps are the raw string/Date props — NOT derived Date objects — to avoid
  // an infinite re-render loop: Object.is(new Date(), new Date()) === false,
  // so derived Date objects in deps cause the effect to fire every render.
  React.useEffect(() => {
    if (!open || !isRangeMode) return

    const start = parseDate(startDate)
    const end = parseDate(endDate)
    setRangeStart(start)
    setRangeEnd(end)
    setSelectingEnd(false)

    if (showTime) {
      setStartTime(
        typeof startDate === 'string' && startDate.includes('T') ? startDate.slice(11, 16) : '00:00'
      )
      setEndTime(
        typeof endDate === 'string' && endDate.includes('T') ? endDate.slice(11, 16) : '23:59'
      )
    }

    if (start) {
      setViewMonth(start.getMonth())
      setViewYear(start.getFullYear())
    } else {
      const now = new Date()
      setViewMonth(now.getMonth())
      setViewYear(now.getFullYear())
    }
  }, [open, isRangeMode, startDate, endDate, showTime])

  // Sync the calendar view when the external single-date value changes.
  // This is a render-phase state update (derived state pattern): safe because
  // it only triggers when singleValueKey — a primitive timestamp — actually changes.
  const singleValueKey = !isRangeMode && selectedDate ? selectedDate.getTime() : undefined
  const [prevSingleValueKey, setPrevSingleValueKey] = React.useState(singleValueKey)
  if (singleValueKey !== prevSingleValueKey) {
    setPrevSingleValueKey(singleValueKey)
    if (selectedDate) {
      setViewMonth(selectedDate.getMonth())
      setViewYear(selectedDate.getFullYear())
    }
  }

  const handleSelectDateSingle = React.useCallback(
    (day: number) => {
      if (!isRangeMode) {
        onChange?.(formatDateAsString(viewYear, viewMonth, day))
        setOpen(false)
      }
    },
    [isRangeMode, onChange, viewYear, viewMonth, setOpen]
  )

  const handleSelectDateRange = React.useCallback(
    (year: number, month: number, day: number) => {
      const date = new Date(year, month, day)
      if (!selectingEnd || !rangeStart) {
        setRangeStart(date)
        setRangeEnd(null)
        setSelectingEnd(true)
      } else {
        if (date < rangeStart) {
          setRangeEnd(rangeStart)
          setRangeStart(date)
        } else {
          setRangeEnd(date)
        }
        setSelectingEnd(false)
      }
    },
    [selectingEnd, rangeStart]
  )

  const handleHoverDate = React.useCallback((year: number, month: number, day: number | null) => {
    setHoverDate(day === null ? null : new Date(year, month, day))
  }, [])

  const goToPrevMonth = React.useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else {
      setViewMonth((m) => m - 1)
    }
  }, [viewMonth])

  const goToNextMonth = React.useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }, [viewMonth])

  const handleSelectToday = React.useCallback(() => {
    if (!isRangeMode) {
      const now = new Date()
      setViewMonth(now.getMonth())
      setViewYear(now.getFullYear())
      onChange?.(formatDateAsString(now.getFullYear(), now.getMonth(), now.getDate()))
      setOpen(false)
    }
  }, [isRangeMode, onChange, setOpen])

  const handleApplyRange = React.useCallback(() => {
    if (!isRangeMode || !onRangeChange || !rangeStart) return

    const start = rangeEnd && rangeEnd < rangeStart ? rangeEnd : rangeStart
    const end = rangeEnd && rangeEnd < rangeStart ? rangeStart : (rangeEnd ?? rangeStart)
    const startStr = formatDateAsString(start.getFullYear(), start.getMonth(), start.getDate())
    const endStr = formatDateAsString(end.getFullYear(), end.getMonth(), end.getDate())

    let effectiveStartTime = startTime
    let effectiveEndTime = endTime
    if (showTime && startStr === endStr && startTime > endTime) {
      effectiveStartTime = endTime
      effectiveEndTime = startTime
    }

    onRangeChange(
      showTime ? `${startStr}T${effectiveStartTime}` : startStr,
      showTime ? `${endStr}T${effectiveEndTime}:59` : endStr
    )
    setOpen(false)
  }, [isRangeMode, onRangeChange, rangeStart, rangeEnd, showTime, startTime, endTime, setOpen])

  const handleCancelRange = React.useCallback(() => {
    if (isRangeMode) onCancel?.()
    setOpen(false)
  }, [isRangeMode, onCancel, setOpen])

  const handleClearRange = React.useCallback(() => {
    setRangeStart(null)
    setRangeEnd(null)
    setSelectingEnd(false)
    if (isRangeMode) onClear?.()
  }, [isRangeMode, onClear])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        setOpen(!open)
      }
    },
    [disabled, open, setOpen]
  )

  const handleTriggerClick = React.useCallback(() => {
    if (!disabled) setOpen(!open)
  }, [disabled, open, setOpen])

  const displayValue = isRangeMode
    ? formatDateRangeForDisplay(parseDate(startDate), parseDate(endDate))
    : formatDateForDisplay(selectedDate)

  const calendarContent = isRangeMode ? (
    <>
      <div className='flex'>
        {/* Left Calendar */}
        <CalendarMonth
          viewMonth={viewMonth}
          viewYear={viewYear}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          hoverDate={hoverDate}
          isRangeMode
          onSelectDate={(day) => handleSelectDateRange(viewYear, viewMonth, day)}
          onHoverDate={(day) => handleHoverDate(viewYear, viewMonth, day)}
          onPrevMonth={goToPrevMonth}
          onNextMonth={goToNextMonth}
          showNavigation='left'
        />

        {/* Divider */}
        <div className='w-[1px] bg-[var(--border-1)]' />

        {/* Right Calendar */}
        <CalendarMonth
          viewMonth={rightViewMonth}
          viewYear={rightViewYear}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          hoverDate={hoverDate}
          isRangeMode
          onSelectDate={(day) => handleSelectDateRange(rightViewYear, rightViewMonth, day)}
          onHoverDate={(day) => handleHoverDate(rightViewYear, rightViewMonth, day)}
          onPrevMonth={goToPrevMonth}
          onNextMonth={goToNextMonth}
          showNavigation='right'
        />
      </div>

      {/* Time inputs */}
      {showTime && (
        <div className='flex border-[var(--border-1)] border-t'>
          <div className='flex flex-1 items-center justify-between gap-2 px-3 py-2'>
            <span className='shrink-0 text-[12px] text-[var(--text-muted)]'>Start</span>
            <TimePicker size='sm' value={startTime} onChange={setStartTime} />
          </div>
          <div className='w-[1px] bg-[var(--border-1)]' />
          <div className='flex flex-1 items-center justify-between gap-2 px-3 py-2'>
            <span className='shrink-0 text-[12px] text-[var(--text-muted)]'>End</span>
            <TimePicker size='sm' value={endTime} onChange={setEndTime} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className='flex items-center justify-between border-[var(--border-1)] border-t px-3 py-2'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleClearRange}
          disabled={!rangeStart && !rangeEnd}
          className='text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)]'
        >
          Clear
        </Button>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={handleCancelRange}>
            Cancel
          </Button>
          <Button variant='active' size='sm' onClick={handleApplyRange} disabled={!rangeStart}>
            Apply
          </Button>
        </div>
      </div>
    </>
  ) : (
    <>
      <CalendarMonth
        viewMonth={viewMonth}
        viewYear={viewYear}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDateSingle}
        onPrevMonth={goToPrevMonth}
        onNextMonth={goToNextMonth}
      />

      {/* Today Button */}
      <div className='border-[var(--border-1)] border-t p-2'>
        <Button variant='active' className='w-full' onClick={handleSelectToday}>
          Today
        </Button>
      </div>
    </>
  )

  const popoverContent = (
    <PopoverContent
      side='bottom'
      align='start'
      sideOffset={4}
      collisionPadding={16}
      className={cn(
        'rounded-md border border-[var(--border-1)] p-0',
        isRangeMode ? 'w-auto' : 'w-[280px]'
      )}
    >
      {calendarContent}
    </PopoverContent>
  )

  if (inline) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-md border border-[var(--border-1)] bg-[var(--surface-2)]',
          isRangeMode ? 'w-auto' : 'w-[280px]',
          className
        )}
        {...htmlProps}
      >
        {calendarContent}
      </div>
    )
  }

  if (!showTrigger) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <div ref={ref} {...htmlProps}>
          <PopoverAnchor asChild>
            <div />
          </PopoverAnchor>
          {popoverContent}
        </div>
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div ref={ref} className='relative w-full' {...htmlProps}>
        <PopoverAnchor asChild>
          <div
            role='button'
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            className={cn(
              datePickerVariants({ variant, size }),
              'relative cursor-pointer items-center justify-between',
              disabled && 'cursor-not-allowed opacity-50',
              className
            )}
            onClick={handleTriggerClick}
            onKeyDown={handleKeyDown}
          >
            <span className={cn('flex-1 truncate', !displayValue && 'text-[var(--text-muted)]')}>
              {displayValue || placeholder}
            </span>
            <ChevronDown
              className={cn(
                'ml-2 h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
                open && 'rotate-180'
              )}
            />
          </div>
        </PopoverAnchor>
        {popoverContent}
      </div>
    </Popover>
  )
})

DatePicker.displayName = 'DatePicker'

export { DatePicker, datePickerVariants }
