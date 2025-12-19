'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { Popover, PopoverAnchor, PopoverContent } from '../popover/popover'

const datePickerVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)] px-[8px] font-sans font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] dark:placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 hover:border-[var(--surface-14)] hover:bg-[var(--surface-9)] dark:hover:border-[var(--surface-13)] dark:hover:bg-[var(--surface-11)]',
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
  /** Current selected date value (ISO string or Date) */
  value?: string | Date
  /** Callback when date changes */
  onChange?: (value: string) => void
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Whether to include time selection */
  includeTime?: boolean
  /** Size variant */
  size?: 'default' | 'sm'
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

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

function formatDateForDisplay(date: Date | null, includeTime: boolean): string {
  if (!date) return ''
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
  if (includeTime) {
    options.hour = '2-digit'
    options.minute = '2-digit'
  }
  return date.toLocaleDateString('en-US', options)
}

function parseDate(value: string | Date | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  try {
    const date = new Date(value)
    return isNaN(date.getTime()) ? null : date
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
    {
      className,
      variant,
      size,
      value,
      onChange,
      placeholder = 'Select date',
      disabled,
      includeTime = false,
      ...props
    },
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
    const [hour, setHour] = React.useState(() => {
      return selectedDate ? selectedDate.getHours() : 12
    })
    const [minute, setMinute] = React.useState(() => {
      return selectedDate ? selectedDate.getMinutes() : 0
    })

    // Update view when value changes externally
    React.useEffect(() => {
      if (selectedDate) {
        setViewMonth(selectedDate.getMonth())
        setViewYear(selectedDate.getFullYear())
        setHour(selectedDate.getHours())
        setMinute(selectedDate.getMinutes())
      }
    }, [value])

    const handleSelectDate = React.useCallback(
      (day: number) => {
        const newDate = new Date(viewYear, viewMonth, day, hour, minute)
        onChange?.(newDate.toISOString())
        if (!includeTime) {
          setOpen(false)
        }
      },
      [viewYear, viewMonth, hour, minute, onChange, includeTime]
    )

    const handleTimeChange = React.useCallback(
      (newHour: number, newMinute: number) => {
        setHour(newHour)
        setMinute(newMinute)
        if (selectedDate) {
          const newDate = new Date(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
            newHour,
            newMinute
          )
          onChange?.(newDate.toISOString())
        }
      },
      [selectedDate, onChange]
    )

    const goToPrevMonth = () => {
      if (viewMonth === 0) {
        setViewMonth(11)
        setViewYear(viewYear - 1)
      } else {
        setViewMonth(viewMonth - 1)
      }
    }

    const goToNextMonth = () => {
      if (viewMonth === 11) {
        setViewMonth(0)
        setViewYear(viewYear + 1)
      } else {
        setViewMonth(viewMonth + 1)
      }
    }

    const daysInMonth = getDaysInMonth(viewYear, viewMonth)
    const firstDayOfMonth = getFirstDayOfMonth(viewYear, viewMonth)
    const today = new Date()
    const isToday = (day: number) => {
      return (
        today.getDate() === day &&
        today.getMonth() === viewMonth &&
        today.getFullYear() === viewYear
      )
    }
    const isSelected = (day: number) => {
      return (
        selectedDate &&
        selectedDate.getDate() === day &&
        selectedDate.getMonth() === viewMonth &&
        selectedDate.getFullYear() === viewYear
      )
    }

    // Build calendar grid
    const calendarDays: (number | null)[] = []
    for (let i = 0; i < firstDayOfMonth; i++) {
      calendarDays.push(null)
    }
    for (let day = 1; day <= daysInMonth; day++) {
      calendarDays.push(day)
    }

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
              onClick={() => !disabled && setOpen(!open)}
              onKeyDown={(e) => {
                if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  setOpen(!open)
                }
              }}
            >
              <span className={cn('flex-1 truncate', !selectedDate && 'text-[var(--text-muted)]')}>
                {selectedDate ? formatDateForDisplay(selectedDate, includeTime) : placeholder}
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
            className='w-[280px] rounded-[6px] border border-[var(--surface-11)] p-0'
          >
            {/* Calendar Header */}
            <div className='flex items-center justify-between border-b border-[var(--surface-11)] px-[12px] py-[10px]'>
              <button
                type='button'
                className='flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)]'
                onClick={goToPrevMonth}
              >
                <ChevronLeft className='h-4 w-4' />
              </button>
              <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button
                type='button'
                className='flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)]'
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
                            ? 'bg-[var(--surface-9)] text-[var(--text-primary)]'
                            : 'text-[var(--text-primary)] hover:bg-[var(--surface-9)]'
                      )}
                      onClick={() => handleSelectDate(day)}
                    >
                      {day}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Time Selection */}
            {includeTime && (
              <div className='flex items-center justify-center gap-[8px] border-t border-[var(--surface-11)] px-[12px] py-[10px]'>
                <span className='text-[12px] text-[var(--text-muted)]'>Time:</span>
                <input
                  type='number'
                  min={0}
                  max={23}
                  value={hour.toString().padStart(2, '0')}
                  onChange={(e) => {
                    const val = Math.min(23, Math.max(0, Number.parseInt(e.target.value) || 0))
                    handleTimeChange(val, minute)
                  }}
                  className='w-[44px] rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[4px] text-center text-[12px] text-[var(--text-primary)] outline-none dark:bg-[var(--surface-9)]'
                />
                <span className='text-[var(--text-muted)]'>:</span>
                <input
                  type='number'
                  min={0}
                  max={59}
                  value={minute.toString().padStart(2, '0')}
                  onChange={(e) => {
                    const val = Math.min(59, Math.max(0, Number.parseInt(e.target.value) || 0))
                    handleTimeChange(hour, val)
                  }}
                  className='w-[44px] rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[4px] text-center text-[12px] text-[var(--text-primary)] outline-none dark:bg-[var(--surface-9)]'
                />
              </div>
            )}

            {/* Today Button */}
            <div className='border-t border-[var(--surface-11)] px-[8px] py-[8px]'>
              <button
                type='button'
                className='w-full rounded-[4px] py-[6px] text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)]'
                onClick={() => {
                  const now = new Date()
                  setViewMonth(now.getMonth())
                  setViewYear(now.getFullYear())
                  handleSelectDate(now.getDate())
                }}
              >
                Today
              </button>
            </div>
          </PopoverContent>
        </div>
      </Popover>
    )
  }
)

DatePicker.displayName = 'DatePicker'

export { DatePicker, datePickerVariants }
