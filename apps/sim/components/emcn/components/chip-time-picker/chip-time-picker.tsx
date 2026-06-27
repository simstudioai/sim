'use client'

import * as React from 'react'
import { ChipInput } from '@/components/emcn/components/chip-input/chip-input'
import { cn } from '@/lib/core/utils/cn'
import { useTranslations } from 'next-intl'

/**
 * Formats an `HH:mm` (24h) value as the 12h display label (`9:30 AM`).
 * Returns `''` for empty or malformed input.
 */
function formatTimeLabel(value?: string): string {
  if (!value) return ''
  const [rawHour, rawMinute] = value.split(':')
  const hour = Number.parseInt(rawHour, 10)
  const minute = Number.parseInt(rawMinute ?? '', 10)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return ''
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`
}

/**
 * Leniently parses typed input into an `HH:mm` value, or `null` when it isn't
 * a time. Accepts `9`, `9:47`, `947`, `1430`, `2pm`, `2:05 pm`, `2.05pm` — a
 * bare hour above 12 reads as 24h; an explicit am/pm requires a 1-12 hour.
 */
function parseTimeInput(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\./g, ':').replace(/\s+/g, ' ')
  const match = /^(\d{1,2}):?([0-5]\d)? ?(am?|pm?)?$/.exec(text)
  if (!match) return null
  let hour = Number.parseInt(match[1], 10)
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0
  const period = match[3]
  if (period) {
    if (hour < 1 || hour > 12) return null
    if (period.startsWith('p')) hour = hour === 12 ? 12 : hour + 12
    else if (hour === 12) hour = 0
  } else if (hour > 23) {
    return null
  }
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export interface ChipTimePickerProps {
  /** Selected time as an `HH:mm` (24h) string. */
  value?: string
  /** Called with the committed time in `HH:mm` format. */
  onChange?: (value: string) => void
  /** Shown while empty. */
  placeholder?: string
  /** Disables the field. */
  disabled?: boolean
  /** Stretch the field to fill its container (mirrors `Chip`'s `fullWidth`). */
  fullWidth?: boolean
  /** Removes the default `mx-0.5` cluster margin (mirrors `Chip`'s `flush`). */
  flush?: boolean
  /** Layout/sizing only — width overrides, margins. The chrome is owned by the chip field. */
  className?: string
}

/**
 * Minute-granular time field on the chip text-field chrome — the time sibling
 * of {@link ChipDatePicker} for footer/toolbar clusters. A plain inline input:
 * type anything time-shaped (`9:47`, `947`, `2:05pm`, `14:30`) and it commits
 * on Enter or blur, re-rendering as the canonical `9:47 AM` label; input that
 * doesn't parse reverts to the last committed time.
 *
 * @example
 * <ChipTimePicker value={time} onChange={setTime} flush />
 */
const ChipTimePicker = React.forwardRef<HTMLInputElement, ChipTimePickerProps>(
  function ChipTimePicker(
    { value, onChange, placeholder = '10:00 AM', disabled, fullWidth, flush, className },
    ref
  ) {
  const t = useTranslations('auto')
    const [text, setText] = React.useState(() => formatTimeLabel(value))
    const [prevValue, setPrevValue] = React.useState(value)

    if (value !== prevValue) {
      setPrevValue(value)
      setText(formatTimeLabel(value))
    }

    /**
     * Commits the typed text: a parseable time normalizes to its canonical
     * label and lifts up via `onChange`; anything else reverts to the last
     * committed value.
     */
    const commit = React.useCallback(() => {
      const parsed = parseTimeInput(text)
      if (parsed) {
        setText(formatTimeLabel(parsed))
        if (parsed !== value) onChange?.(parsed)
        return
      }
      setText(formatTimeLabel(value))
    }, [text, value, onChange])

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Escape') {
          setText(formatTimeLabel(value))
          event.currentTarget.blur()
        }
      },
      [value]
    )

    return (
      <ChipInput
        ref={ref}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={t('time')}
        autoComplete='off'
        spellCheck={false}
        className={cn(fullWidth ? 'w-full' : 'w-[88px]', flush ? 'mx-0' : 'mx-0.5', className)}
      />
    )
  }
)

ChipTimePicker.displayName = 'ChipTimePicker'

export { ChipTimePicker }
