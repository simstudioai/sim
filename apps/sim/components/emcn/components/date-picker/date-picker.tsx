/**
 * DatePicker component with calendar dropdown for date selection.
 * Uses Radix UI Popover primitives for positioning and accessibility.
 *
 * @example
 * ```tsx
 * // Basic date picker
 * <DatePicker
 *   value={date}
 *   onChange={(dateString) => setDate(dateString)}
 *   placeholder="Select date"
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
  'flex w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] font-sans font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 hover:border-[var(--surface-7)] hover:bg-[var(--surface-5)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]',
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

export interface DatePickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>,
    VariantProps<typeof datePickerVariants> {
  /** Current selected date value (YYYY-MM-DD string or Date) */
  value?: string | Date
  /** Callback when date changes, returns YYYY-MM-DD format */
  onChange?: (value: string) => void
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Size variant */
  size?: 'default' | 'sm'
}

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
 * Formats a date for display in the trigger button.
 */
function formatDateForDisplay(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Formats a date as YYYY-MM-DD string.
 */
function formatDateAsString(year: number, month: number, day: number): string {
  const m = (month + 1).toString().padStart(2, '0')
  const d = day.toString().padStart(2, '0')
  return `${year}-${m}-${d}`
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
    // Handle YYYY-MM-DD format (treat as local date)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number)
      return new Date(year, month - 1, day)
    }

    // Handle ISO strings with timezone (extract date part as local)
    if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return null
      // Use UTC date components to prevent timezone shift
      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    }

    // Fallback: try parsing as-is
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

/**
 * DatePicker component matching emcn design patterns.
 * Provides a calendar dropdown for date selection.
 */
const DatePicker = React.forwardRef<HTMLDivElement, DatePickerProps>(
  (
    { className, variant, size, value, onChange, placeholder = 'Select date', disabled, ...props },
    ref
  ) => {
    const [open, setOpen] = React.useState(false)
    const selectedDate = parseDate(value)

    const [viewMonth, setViewMonth] = React.useState(() => {
      const d = selectedDate || new Date()
      return d.getMonth()
    })
    const [viewYear, setViewYear] = React.useState(() => {
      const d = selectedDate || new Date()
      return d.getFullYear()
    })

    // Update view when value changes externally
    React.useEffect(() => {
      if (selectedDate) {
        setViewMonth(selectedDate.getMonth())
        setViewYear(selectedDate.getFullYear())
      }
    }, [value])

    /**
     * Handles selection of a specific day in the calendar.
     */
    const handleSelectDate = React.useCallback(
      (day: number) => {
        onChange?.(formatDateAsString(viewYear, viewMonth, day))
        setOpen(false)
      },
      [viewYear, viewMonth, onChange]
    )

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
     * Selects today's date and closes the picker.
     */
    const handleSelectToday = React.useCallback(() => {
      const now = new Date()
      setViewMonth(now.getMonth())
      setViewYear(now.getFullYear())
      onChange?.(formatDateAsString(now.getFullYear(), now.getMonth(), now.getDate()))
      setOpen(false)
    }, [onChange])

    const daysInMonth = getDaysInMonth(viewYear, viewMonth)
    const firstDayOfMonth = getFirstDayOfMonth(viewYear, viewMonth)

    /**
     * Checks if a day is today's date.
     */
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

    /**
     * Checks if a day is the currently selected date.
     */
    const isSelected = React.useCallback(
      (day: number) => {
        return (
          selectedDate &&
          selectedDate.getDate() === day &&
          selectedDate.getMonth() === viewMonth &&
          selectedDate.getFullYear() === viewYear
        )
      },
      [selectedDate, viewMonth, viewYear]
    )

    // Build calendar grid
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
      [disabled, open]
    )

    /**
     * Handles click on the trigger.
     */
    const handleTriggerClick = React.useCallback(() => {
      if (!disabled) {
        setOpen(!open)
      }
    }, [disabled, open])

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <div ref={ref} className='relative w-full' {...props}>
          <PopoverAnchor asChild>
            <div
              role='button'
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              className={cn(
                datePickerVariants({ variant, size }),
                'relative cursor-pointer items-center justify-between',
                className
              )}
              onClick={handleTriggerClick}
              onKeyDown={handleKeyDown}
            >
              <span className={cn('flex-1 truncate', !selectedDate && 'text-[var(--text-muted)]')}>
                {selectedDate ? formatDateForDisplay(selectedDate) : placeholder}
              </span>
              <ChevronDown
                className={cn(
                  'ml-[8px] h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
                  open && 'rotate-180'
                )}
              />
            </div>
          </PopoverAnchor>

          <PopoverContent
            side='bottom'
            align='start'
            sideOffset={4}
            avoidCollisions={false}
            className='w-[280px] rounded-[6px] border border-[var(--border-1)] p-0'
          >
            {/* Calendar Header */}
            <div className='flex items-center justify-between border-[var(--border-1)] border-b px-[12px] py-[10px]'>
              <button
                type='button'
                className='flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
                onClick={goToPrevMonth}
              >
                <ChevronLeft className='h-4 w-4' />
              </button>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button
                type='button'
                className='flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
                onClick={goToNextMonth}
              >
                <ChevronRight className='h-4 w-4' />
              </button>
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
              {calendarDays.map((day, index) => (
                <div key={index} className='flex h-[32px] items-center justify-center'>
                  {day !== null && (
                    <button
                      type='button'
                      className={cn(
                        'flex h-[28px] w-[28px] items-center justify-center rounded-[4px] text-[12px] transition-colors',
                        isSelected(day)
                          ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                          : isToday(day)
                            ? 'bg-[var(--surface-5)] text-[var(--text-primary)]'
                            : 'text-[var(--text-primary)] hover:bg-[var(--surface-5)]'
                      )}
                      onClick={() => handleSelectDate(day)}
                    >
                      {day}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Today Button */}
            <div className='border-[var(--border-1)] border-t px-[8px] py-[8px]'>
              <Button variant='active' className='w-full' onClick={handleSelectToday}>
                Today
              </Button>
            </div>
          </PopoverContent>
        </div>
      </Popover>
    )
  }
)

DatePicker.displayName = 'DatePicker'

export { DatePicker, datePickerVariants }
