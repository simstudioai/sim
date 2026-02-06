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
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the date picker trigger button.
 * Matches the combobox and input styling patterns.
 */
const datePickerVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] font-sans font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
      },
      size: {
        default: 'py-[6px] text-sm',
        sm: 'py-[5px] text-[12px]',
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
  /** Current selected date value (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss string, or Date) */
  value?: string | Date
  /** Callback when date changes, returns YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss format */
  onChange?: (value: string) => void
  /** When true, shows time picker after date selection and outputs ISO 8601 format */
  showTime?: boolean
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
}

/** Props for range date mode */
interface DatePickerRangeProps extends DatePickerBaseProps {
  /** Selection mode */
  mode: 'range'
  /** Start date for range mode (YYYY-MM-DD string or Date) */
  startDate?: string | Date
  /** End date for range mode (YYYY-MM-DD string or Date) */
  endDate?: string | Date
  /** Callback when date range is applied */
  onRangeChange?: (startDate: string, endDate: string) => void
  /** Callback when range selection is cancelled */
  onCancel?: () => void
  /** Callback when range is cleared */
  onClear?: () => void
  /** Not used in range mode */
  value?: never
  /** Not used in range mode */
  onChange?: never
}

export type DatePickerProps = DatePickerSingleProps | DatePickerRangeProps

/**
 * Month names for calendar display.
 */
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

/**
 * Day abbreviations for calendar header.
 */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * Gets the number of days in a given month.
 */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Gets the day of the week (0-6) for the first day of the month.
 */
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

/**
 * Short month names for display.
 */
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

/**
 * Formats a date for display in the trigger button.
 * If time is provided, formats as "Jan 30, 2026 at 2:30 PM"
 */
function formatDateForDisplay(date: Date | null, time?: string | null): string {
  if (!date) return ''
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  if (time) {
    return `${dateStr} at ${formatDisplayTime(time)}`
  }
  return dateStr
}

/**
 * Converts a 24h time string to 12h display format with AM/PM.
 */
function formatDisplayTime(time: string): string {
  if (!time) return ''
  const [hours, minutes] = time.split(':')
  const hour = Number.parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minutes} ${ampm}`
}

/**
 * Converts 12h time components to 24h format string.
 */
function formatStorageTime(hour: number, minute: number, ampm: 'AM' | 'PM'): string {
  const hours24 = ampm === 'PM' ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour
  return `${hours24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

/**
 * Parses a 24h time string into 12h components.
 * Returns default 12:00 PM if no time provided (for UI display only).
 */
function parseTimeComponents(time: string | null): {
  hour: string
  minute: string
  ampm: 'AM' | 'PM'
} {
  if (!time) return { hour: '12', minute: '00', ampm: 'PM' }
  const [hours, minutes] = time.split(':')
  const hour24 = Number.parseInt(hours, 10)
  const isAM = hour24 < 12
  return {
    hour: (hour24 % 12 || 12).toString(),
    minute: minutes || '00',
    ampm: isAM ? 'AM' : 'PM',
  }
}

/**
 * Checks if a value contains time information.
 */
function valueHasTime(value: string | Date | undefined): boolean {
  if (!value) return false
  if (value instanceof Date) {
    // Check if time is not midnight (default)
    return value.getHours() !== 0 || value.getMinutes() !== 0
  }
  // Check for ISO datetime format: YYYY-MM-DDTHH:mm
  return /T\d{2}:\d{2}/.test(value)
}

/**
 * Extracts time from a datetime string or Date object.
 * Returns HH:mm format or null if no time present.
 */
function extractTimeFromValue(value: string | Date | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) {
    // Only return time if it's not midnight (which could be default)
    if (value.getHours() === 0 && value.getMinutes() === 0) return null
    return `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`
  }
  // Check for ISO datetime format: YYYY-MM-DDTHH:mm:ss
  const match = value.match(/T(\d{2}):(\d{2})/)
  if (match) {
    return `${match[1]}:${match[2]}`
  }
  return null
}

/**
 * Formats a date range for display.
 */
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

/**
 * Checks if a date is between two dates (inclusive).
 */
function isDateInRange(date: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false
  const time = date.getTime()
  const startTime = Math.min(start.getTime(), end.getTime())
  const endTime = Math.max(start.getTime(), end.getTime())
  return time >= startTime && time <= endTime
}

/**
 * Checks if two dates are the same day.
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * Formats a date as YYYY-MM-DD string, optionally with time as YYYY-MM-DDTHH:mm:ss.
 */
function formatDateAsString(year: number, month: number, day: number, time?: string): string {
  const m = (month + 1).toString().padStart(2, '0')
  const d = day.toString().padStart(2, '0')
  const dateStr = `${year}-${m}-${d}`
  if (time) {
    return `${dateStr}T${time}:00`
  }
  return dateStr
}

/**
 * Parses a string or Date value into a Date object.
 * Handles various date formats including YYYY-MM-DD and ISO strings.
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

/**
 * Calendar component for rendering a single month.
 */
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
  hoverDate,
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
      if (!isRangeMode) return false
      const date = new Date(viewYear, viewMonth, day)
      // Only show range highlight when both start and end are selected
      if (rangeStart && rangeEnd) {
        return (
          isDateInRange(date, rangeStart, rangeEnd) &&
          !isSameDay(date, rangeStart) &&
          !isSameDay(date, rangeEnd)
        )
      }
      return false
    },
    [isRangeMode, rangeStart, rangeEnd, viewMonth, viewYear]
  )

  return (
    <div className='flex flex-col'>
      {/* Calendar Header */}
      <div className='flex items-center justify-between border-[var(--border-1)] border-b px-[12px] py-[10px]'>
        {showNavigation === 'left' || showNavigation === 'both' ? (
          <button
            type='button'
            className='flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
            onClick={onPrevMonth}
          >
            <ChevronLeft className='h-4 w-4' />
          </button>
        ) : (
          <div className='h-[24px] w-[24px]' />
        )}
        <span className='font-medium text-[13px] text-[var(--text-primary)]'>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        {showNavigation === 'right' || showNavigation === 'both' ? (
          <button
            type='button'
            className='flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
            onClick={onNextMonth}
          >
            <ChevronRight className='h-4 w-4' />
          </button>
        ) : (
          <div className='h-[24px] w-[24px]' />
        )}
      </div>

      {/* Day Headers */}
      <div className='grid grid-cols-7 px-[8px] pt-[8px]'>
        {DAYS.map((day) => (
          <div
            key={day}
            className='flex h-[28px] items-center justify-center text-[11px] text-[var(--text-muted)]'
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className='grid grid-cols-7 px-[8px] pb-[8px]'>
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
                isRangeMode && isStart && isEnd && 'before:rounded-[4px]'
              )}
            >
              {day !== null && (
                <button
                  type='button'
                  className={cn(
                    'relative z-10 flex h-[28px] w-[28px] items-center justify-center rounded-[4px] text-[12px] transition-colors',
                    isRangeMode
                      ? isStart || isEnd
                        ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                        : inRange
                          ? 'text-[var(--text-primary)] hover:bg-[#60a5fa]/40'
                          : 'text-[var(--text-primary)] hover:bg-[var(--surface-5)]'
                      : isSelected(day)
                        ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                        : isToday(day)
                          ? 'bg-[var(--surface-5)] text-[var(--text-primary)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--surface-5)]'
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
    placeholder = props.mode === 'range' ? 'Select date range' : 'Select date',
    disabled,
    showTrigger = true,
    open: controlledOpen,
    onOpenChange,
    inline = false,
    mode: _mode,
    ...rest
  } = props

  const {
    value: _value,
    onChange: _onChange,
    showTime: _showTime,
    startDate: _startDate,
    endDate: _endDate,
    onRangeChange: _onRangeChange,
    onCancel: _onCancel,
    onClear: _onClear,
    ...htmlProps
  } = rest as any

  const isRangeMode = props.mode === 'range'
  const showTime = !isRangeMode && (props as DatePickerSingleProps).showTime === true

  const isControlled = controlledOpen !== undefined
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setInternalOpen(value)
      }
      onOpenChange?.(value)
    },
    [isControlled, onOpenChange]
  )

  const selectedDate = !isRangeMode ? parseDate(props.value) : null

  // Time state for showTime mode
  // Track whether the incoming value has time
  const valueTimeInfo = React.useMemo(() => {
    if (!showTime) return { hasTime: false, time: null }
    const time = extractTimeFromValue(props.value)
    return { hasTime: time !== null, time }
  }, [showTime, props.value])

  const parsedTime = React.useMemo(
    () => parseTimeComponents(valueTimeInfo.time),
    [valueTimeInfo.time]
  )
  const [hour, setHour] = React.useState(parsedTime.hour)
  const [minute, setMinute] = React.useState(parsedTime.minute)
  const [ampm, setAmpm] = React.useState<'AM' | 'PM'>(parsedTime.ampm)
  // Track whether user has explicitly set time (either from value or interaction)
  const [timeWasSet, setTimeWasSet] = React.useState(valueTimeInfo.hasTime)
  const hourInputRef = React.useRef<HTMLInputElement>(null)

  // Sync time state when value changes
  React.useEffect(() => {
    if (showTime) {
      const time = extractTimeFromValue(props.value)
      const newParsed = parseTimeComponents(time)
      setHour(newParsed.hour)
      setMinute(newParsed.minute)
      setAmpm(newParsed.ampm)
      setTimeWasSet(time !== null)
    }
  }, [showTime, props.value])

  const initialStart = isRangeMode ? parseDate(props.startDate) : null
  const initialEnd = isRangeMode ? parseDate(props.endDate) : null
  const [rangeStart, setRangeStart] = React.useState<Date | null>(initialStart)
  const [rangeEnd, setRangeEnd] = React.useState<Date | null>(initialEnd)
  const [hoverDate, setHoverDate] = React.useState<Date | null>(null)
  const [selectingEnd, setSelectingEnd] = React.useState(false)

  const [viewMonth, setViewMonth] = React.useState(() => {
    const d = selectedDate || initialStart || new Date()
    return d.getMonth()
  })
  const [viewYear, setViewYear] = React.useState(() => {
    const d = selectedDate || initialStart || new Date()
    return d.getFullYear()
  })

  const rightViewMonth = viewMonth === 11 ? 0 : viewMonth + 1
  const rightViewYear = viewMonth === 11 ? viewYear + 1 : viewYear

  React.useEffect(() => {
    if (open && isRangeMode) {
      setRangeStart(initialStart)
      setRangeEnd(initialEnd)
      setSelectingEnd(false)
      if (initialStart) {
        setViewMonth(initialStart.getMonth())
        setViewYear(initialStart.getFullYear())
      } else {
        const now = new Date()
        setViewMonth(now.getMonth())
        setViewYear(now.getFullYear())
      }
    }
  }, [open, isRangeMode, initialStart, initialEnd])

  React.useEffect(() => {
    if (!isRangeMode && selectedDate) {
      setViewMonth(selectedDate.getMonth())
      setViewYear(selectedDate.getFullYear())
    }
  }, [isRangeMode, selectedDate])

  /**
   * Gets the current time string in 24h format.
   */
  const getCurrentTimeString = React.useCallback(() => {
    const h = Number.parseInt(hour) || 12
    const m = Number.parseInt(minute) || 0
    return formatStorageTime(h, m, ampm)
  }, [hour, minute, ampm])

  /**
   * Handles selection of a specific day in single mode.
   */
  const handleSelectDateSingle = React.useCallback(
    (day: number) => {
      if (!isRangeMode && props.onChange) {
        if (showTime && timeWasSet) {
          // Only include time if it was explicitly set
          props.onChange(formatDateAsString(viewYear, viewMonth, day, getCurrentTimeString()))
        } else {
          props.onChange(formatDateAsString(viewYear, viewMonth, day))
          if (!showTime) {
            setOpen(false)
          }
        }
      }
    },
    [
      isRangeMode,
      viewYear,
      viewMonth,
      props.onChange,
      setOpen,
      showTime,
      getCurrentTimeString,
      timeWasSet,
    ]
  )

  /**
   * Handles hour input change.
   */
  const handleHourChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
    setHour(val)
  }, [])

  /**
   * Handles hour input blur - validates and updates value.
   */
  const handleHourBlur = React.useCallback(() => {
    const numVal = Number.parseInt(hour) || 12
    const clamped = Math.min(12, Math.max(1, numVal))
    setHour(clamped.toString())
    setTimeWasSet(true)
    if (selectedDate && props.onChange && showTime) {
      const timeStr = formatStorageTime(clamped, Number.parseInt(minute) || 0, ampm)
      props.onChange(
        formatDateAsString(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          timeStr
        )
      )
    }
  }, [hour, minute, ampm, selectedDate, props.onChange, showTime])

  /**
   * Handles minute input change.
   */
  const handleMinuteChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
    setMinute(val)
  }, [])

  /**
   * Handles minute input blur - validates and updates value.
   */
  const handleMinuteBlur = React.useCallback(() => {
    const numVal = Number.parseInt(minute) || 0
    const clamped = Math.min(59, Math.max(0, numVal))
    setMinute(clamped.toString().padStart(2, '0'))
    setTimeWasSet(true)
    if (selectedDate && props.onChange && showTime) {
      const timeStr = formatStorageTime(Number.parseInt(hour) || 12, clamped, ampm)
      props.onChange(
        formatDateAsString(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          timeStr
        )
      )
    }
  }, [minute, hour, ampm, selectedDate, props.onChange, showTime])

  /**
   * Handles AM/PM toggle.
   */
  const handleAmpmChange = React.useCallback(
    (newAmpm: 'AM' | 'PM') => {
      setAmpm(newAmpm)
      setTimeWasSet(true)
      if (selectedDate && props.onChange && showTime) {
        const timeStr = formatStorageTime(
          Number.parseInt(hour) || 12,
          Number.parseInt(minute) || 0,
          newAmpm
        )
        props.onChange(
          formatDateAsString(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
            timeStr
          )
        )
      }
    },
    [hour, minute, selectedDate, props.onChange, showTime]
  )

  /**
   * Handles keyboard navigation in hour input (Enter, ArrowUp, ArrowDown).
   */
  const handleHourKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur()
        setOpen(false)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!timeWasSet) setTimeWasSet(true)
        setHour((prev) => {
          const num = Number.parseInt(prev, 10) || 12
          const next = num >= 12 ? 1 : num + 1
          return next.toString()
        })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!timeWasSet) setTimeWasSet(true)
        setHour((prev) => {
          const num = Number.parseInt(prev, 10) || 12
          const next = num <= 1 ? 12 : num - 1
          return next.toString()
        })
      }
    },
    [setOpen, timeWasSet]
  )

  /**
   * Handles keyboard navigation in minute input (Enter, ArrowUp, ArrowDown).
   */
  const handleMinuteKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur()
        setOpen(false)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!timeWasSet) setTimeWasSet(true)
        setMinute((prev) => {
          const num = Number.parseInt(prev, 10) || 0
          const next = num >= 59 ? 0 : num + 1
          return next.toString().padStart(2, '0')
        })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!timeWasSet) setTimeWasSet(true)
        setMinute((prev) => {
          const num = Number.parseInt(prev, 10) || 0
          const next = num <= 0 ? 59 : num - 1
          return next.toString().padStart(2, '0')
        })
      }
    },
    [setOpen, timeWasSet]
  )

  /**
   * Handles selection of a day in range mode.
   */
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

  /**
   * Handles hover for range preview.
   */
  const handleHoverDate = React.useCallback((year: number, month: number, day: number | null) => {
    if (day === null) {
      setHoverDate(null)
    } else {
      setHoverDate(new Date(year, month, day))
    }
  }, [])

  /**
   * Navigates to the previous month.
   */
  const goToPrevMonth = React.useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((prev) => prev - 1)
    } else {
      setViewMonth((prev) => prev - 1)
    }
  }, [viewMonth])

  /**
   * Navigates to the next month.
   */
  const goToNextMonth = React.useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((prev) => prev + 1)
    } else {
      setViewMonth((prev) => prev + 1)
    }
  }, [viewMonth])

  /**
   * Selects today's date (single mode only).
   * Preserves existing time if set, otherwise outputs date only.
   */
  const handleSelectToday = React.useCallback(() => {
    if (!isRangeMode && props.onChange) {
      const now = new Date()
      setViewMonth(now.getMonth())
      setViewYear(now.getFullYear())
      if (showTime && timeWasSet) {
        // Only include time if it was explicitly set
        props.onChange(
          formatDateAsString(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            getCurrentTimeString()
          )
        )
      } else {
        props.onChange(formatDateAsString(now.getFullYear(), now.getMonth(), now.getDate()))
        if (!showTime) {
          setOpen(false)
        }
      }
    }
  }, [isRangeMode, props.onChange, setOpen, showTime, getCurrentTimeString, timeWasSet])

  /**
   * Applies the selected range (range mode only).
   */
  const handleApplyRange = React.useCallback(() => {
    if (isRangeMode && props.onRangeChange && rangeStart) {
      const start = rangeEnd && rangeEnd < rangeStart ? rangeEnd : rangeStart
      const end = rangeEnd && rangeEnd < rangeStart ? rangeStart : rangeEnd || rangeStart
      props.onRangeChange(
        formatDateAsString(start.getFullYear(), start.getMonth(), start.getDate()),
        formatDateAsString(end.getFullYear(), end.getMonth(), end.getDate())
      )
      setOpen(false)
    }
  }, [isRangeMode, props.onRangeChange, rangeStart, rangeEnd, setOpen])

  /**
   * Cancels range selection.
   */
  const handleCancelRange = React.useCallback(() => {
    if (isRangeMode && props.onCancel) {
      props.onCancel()
    }
    setOpen(false)
  }, [isRangeMode, props.onCancel, setOpen])

  /**
   * Clears the selected range.
   */
  const handleClearRange = React.useCallback(() => {
    setRangeStart(null)
    setRangeEnd(null)
    setSelectingEnd(false)
    if (isRangeMode && props.onClear) {
      props.onClear()
    }
  }, [isRangeMode, props.onClear])

  /**
   * Handles keyboard events on the trigger.
   */
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        setOpen(!open)
      }
    },
    [disabled, open, setOpen]
  )

  /**
   * Handles click on the trigger.
   */
  const handleTriggerClick = React.useCallback(() => {
    if (!disabled) {
      setOpen(!open)
    }
  }, [disabled, open, setOpen])

  // Only show time in display if it was explicitly set
  const displayTime = showTime && timeWasSet ? getCurrentTimeString() : null
  const displayValue = isRangeMode
    ? formatDateRangeForDisplay(initialStart, initialEnd)
    : formatDateForDisplay(selectedDate, displayTime)

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

      {/* Actions */}
      <div className='flex items-center justify-between border-[var(--border-1)] border-t px-[12px] py-[8px]'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleClearRange}
          disabled={!rangeStart && !rangeEnd}
          className='text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        >
          Clear
        </Button>
        <div className='flex items-center gap-[8px]'>
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

      {/* Time Picker (when showTime is enabled) */}
      {showTime && (
        <div className='flex items-center justify-center gap-[6px] border-[var(--border-1)] border-t px-[12px] py-[10px]'>
          <span className='font-medium text-[12px] text-[var(--text-muted)]'>Time:</span>
          <input
            ref={hourInputRef}
            className={cn(
              'w-[40px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[6px] py-[5px] text-center font-medium font-sans text-[13px] outline-none transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0',
              timeWasSet ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
            )}
            value={hour}
            onChange={(e) => {
              handleHourChange(e)
              if (!timeWasSet) setTimeWasSet(true)
            }}
            onBlur={handleHourBlur}
            onFocus={(e) => e.target.select()}
            onKeyDown={handleHourKeyDown}
            type='text'
            inputMode='numeric'
            maxLength={2}
            autoComplete='off'
          />
          <span className='font-medium text-[13px] text-[var(--text-muted)]'>:</span>
          <input
            className={cn(
              'w-[40px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[6px] py-[5px] text-center font-medium font-sans text-[13px] outline-none transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0',
              timeWasSet ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
            )}
            value={minute}
            onChange={(e) => {
              handleMinuteChange(e)
              if (!timeWasSet) setTimeWasSet(true)
            }}
            onBlur={handleMinuteBlur}
            onFocus={(e) => e.target.select()}
            onKeyDown={handleMinuteKeyDown}
            type='text'
            inputMode='numeric'
            maxLength={2}
            autoComplete='off'
          />
          <div
            className={cn(
              'ml-[2px] flex overflow-hidden rounded-[4px] border border-[var(--border-1)]',
              !timeWasSet && 'opacity-50'
            )}
          >
            {(['AM', 'PM'] as const).map((period) => (
              <button
                key={period}
                type='button'
                onClick={() => handleAmpmChange(period)}
                className={cn(
                  'px-[8px] py-[5px] font-medium font-sans text-[12px] transition-colors',
                  timeWasSet && ampm === period
                    ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                    : 'bg-[var(--surface-5)] text-[var(--text-secondary)] hover:bg-[var(--surface-7)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-5)]'
                )}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Today Button (only shown when time picker is not enabled) */}
      {!showTime && (
        <div className='border-[var(--border-1)] border-t px-[8px] py-[8px]'>
          <Button variant='active' className='w-full' onClick={handleSelectToday}>
            Today
          </Button>
        </div>
      )}
    </>
  )

  const popoverContent = (
    <PopoverContent
      side='bottom'
      align='start'
      sideOffset={4}
      avoidCollisions={false}
      className={cn(
        'rounded-[6px] border border-[var(--border-1)] p-0',
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
          'rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-2)]',
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
                'ml-[8px] h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
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
