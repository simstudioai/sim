/**
 * TimePicker component with popover dropdown for time selection.
 * Uses Radix UI Popover primitives for positioning and accessibility.
 *
 * @example
 * ```tsx
 * // Basic time picker
 * <TimePicker
 *   value={time}
 *   onChange={(timeString) => setTime(timeString)}
 *   placeholder="Select time"
 * />
 *
 * // Small size variant
 * <TimePicker
 *   value={time}
 *   onChange={setTime}
 *   size="sm"
 * />
 *
 * // Disabled state
 * <TimePicker value="09:00" disabled />
 * ```
 */

'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown } from 'lucide-react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/emcn/components/popover/popover'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the time picker trigger.
 * Matches the input and combobox styling patterns.
 */
const timePickerVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] font-sans font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 hover:border-[var(--surface-7)] hover:bg-[var(--surface-5)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)] transition-colors',
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

/**
 * Props for the TimePicker component.
 */
export interface TimePickerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>,
    VariantProps<typeof timePickerVariants> {
  /** Current time value in 24h format (HH:mm) */
  value?: string
  /** Callback when time changes, returns HH:mm format */
  onChange?: (value: string) => void
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Size variant */
  size?: 'default' | 'sm'
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
 */
function parseTime(time: string): { hour: string; minute: string; ampm: 'AM' | 'PM' } {
  if (!time) return { hour: '12', minute: '00', ampm: 'AM' }
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
 * TimePicker component matching emcn design patterns.
 * Provides a popover dropdown for time selection.
 */
const TimePicker = React.forwardRef<HTMLDivElement, TimePickerProps>(
  (
    {
      className,
      variant,
      size,
      value,
      onChange,
      placeholder = 'Select time',
      disabled = false,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false)
    const hourInputRef = React.useRef<HTMLInputElement>(null)
    const parsed = React.useMemo(() => parseTime(value || ''), [value])
    const [hour, setHour] = React.useState(parsed.hour)
    const [minute, setMinute] = React.useState(parsed.minute)
    const [ampm, setAmpm] = React.useState<'AM' | 'PM'>(parsed.ampm)

    React.useEffect(() => {
      const newParsed = parseTime(value || '')
      setHour(newParsed.hour)
      setMinute(newParsed.minute)
      setAmpm(newParsed.ampm)
    }, [value])

    React.useEffect(() => {
      if (open) {
        setTimeout(() => {
          hourInputRef.current?.focus()
          hourInputRef.current?.select()
        }, 0)
      }
    }, [open])

    const updateTime = React.useCallback(
      (newHour?: string, newMinute?: string, newAmpm?: 'AM' | 'PM') => {
        if (disabled) return
        const h = Number.parseInt(newHour ?? hour) || 12
        const m = Number.parseInt(newMinute ?? minute) || 0
        const p = newAmpm ?? ampm
        onChange?.(formatStorageTime(h, m, p))
      },
      [disabled, hour, minute, ampm, onChange]
    )

    const handleHourChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
      setHour(val)
    }, [])

    const handleHourBlur = React.useCallback(() => {
      const numVal = Number.parseInt(hour) || 12
      const clamped = Math.min(12, Math.max(1, numVal))
      setHour(clamped.toString())
      updateTime(clamped.toString())
    }, [hour, updateTime])

    const handleMinuteChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 2)
      setMinute(val)
    }, [])

    const handleMinuteBlur = React.useCallback(() => {
      const numVal = Number.parseInt(minute) || 0
      const clamped = Math.min(59, Math.max(0, numVal))
      setMinute(clamped.toString().padStart(2, '0'))
      updateTime(undefined, clamped.toString())
    }, [minute, updateTime])

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
     * Handles Enter key in inputs to close picker.
     */
    const handleInputKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur()
        setOpen(false)
      }
    }, [])

    const handleTriggerClick = React.useCallback(() => {
      if (!disabled) {
        setOpen(!open)
      }
    }, [disabled, open])

    const displayValue = value ? formatDisplayTime(value) : ''

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <div ref={ref} className='relative w-full' {...props}>
          <PopoverAnchor asChild>
            <div
              role='button'
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              className={cn(
                timePickerVariants({ variant, size }),
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

          <PopoverContent
            side='bottom'
            align='start'
            sideOffset={4}
            className='w-auto rounded-[6px] border border-[var(--border-1)] p-[8px]'
          >
            <div className='flex items-center gap-[6px]'>
              <input
                ref={hourInputRef}
                className='w-[40px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[6px] py-[5px] text-center font-medium font-sans text-[13px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0'
                value={hour}
                onChange={handleHourChange}
                onBlur={handleHourBlur}
                onKeyDown={handleInputKeyDown}
                type='text'
                inputMode='numeric'
                maxLength={2}
                autoComplete='off'
              />
              <span className='font-medium text-[13px] text-[var(--text-muted)]'>:</span>
              <input
                className='w-[40px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[6px] py-[5px] text-center font-medium font-sans text-[13px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:outline-none focus-visible:outline-none focus-visible:ring-0'
                value={minute}
                onChange={handleMinuteChange}
                onBlur={handleMinuteBlur}
                onKeyDown={handleInputKeyDown}
                type='text'
                inputMode='numeric'
                maxLength={2}
                autoComplete='off'
              />
              <div className='ml-[2px] flex overflow-hidden rounded-[4px] border border-[var(--border-1)]'>
                {(['AM', 'PM'] as const).map((period) => (
                  <button
                    key={period}
                    type='button'
                    onClick={() => {
                      setAmpm(period)
                      updateTime(undefined, undefined, period)
                    }}
                    className={cn(
                      'px-[8px] py-[5px] font-medium font-sans text-[12px] transition-colors',
                      ampm === period
                        ? 'bg-[var(--brand-secondary)] text-[var(--bg)]'
                        : 'bg-[var(--surface-5)] text-[var(--text-secondary)] hover:bg-[var(--surface-7)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-5)]'
                    )}
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </div>
      </Popover>
    )
  }
)

TimePicker.displayName = 'TimePicker'

export { TimePicker, timePickerVariants }
