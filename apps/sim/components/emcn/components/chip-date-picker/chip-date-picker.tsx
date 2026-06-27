'use client'

import { forwardRef, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  Calendar,
  formatDateLabel,
  formatDateRangeLabel,
} from '@/components/emcn/components/calendar/calendar'
import { chipVariants, TRIGGER_BORDER_CLASS } from '@/components/emcn/components/chip/chip'
import { chipContentLabelClass } from '@/components/emcn/components/chip/chip-chrome'
import { POPOVER_ANIMATION_CLASSES } from '@/components/emcn/components/popover/popover-animation'
import { ChevronDown } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

interface ChipDatePickerBaseProps {
  /**
   * Trigger chrome. `filled` (default) is the bordered field chip with the owned
   * chevron; `ghost` is the bare toolbar pill — no border, no chevron — for
   * visual parity with neighboring `Chip` buttons.
   */
  variant?: 'filled' | 'ghost'
  /**
   * Overrides the trigger text, e.g. a calendar period label ("June 2026") whose
   * granularity differs from the selected value.
   */
  label?: string
  /** Shown in the trigger when nothing is selected. */
  placeholder?: string
  /** Aligns the calendar popover relative to the trigger. */
  align?: 'start' | 'center' | 'end'
  /** Disables the trigger. */
  disabled?: boolean
  /** Stretch the trigger to fill its container (mirrors `Chip`'s `fullWidth`). */
  fullWidth?: boolean
  /** Removes the default `mx-0.5` cluster margin (mirrors `Chip`'s `flush`). */
  flush?: boolean
  /** Forwarded class for the trigger button. */
  className?: string
}

interface ChipDatePickerSingleProps extends ChipDatePickerBaseProps {
  mode?: 'single'
  /** Selected date as a `YYYY-MM-DD` string. */
  value?: string
  /** Called with the picked date in `YYYY-MM-DD` format. */
  onChange?: (value: string) => void
}

interface ChipDatePickerRangeProps extends ChipDatePickerBaseProps {
  mode: 'range'
  /** Range start as a `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm`) string. */
  startDate?: string
  /** Range end as a `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm`) string. */
  endDate?: string
  /** Adds start/end time-of-day inputs; emits `YYYY-MM-DDTHH:mm` bounds. */
  showTime?: boolean
  /** Called on Apply with the ordered range bounds. */
  onRangeChange: (start: string, end: string) => void
}

export type ChipDatePickerProps = ChipDatePickerSingleProps | ChipDatePickerRangeProps

/**
 * Date counterpart to {@link ChipDropdown} — a chip-styled trigger that opens a
 * {@link Calendar} in a popover. The default `filled` trigger reuses
 * `chipVariants` (filled + border) and the owned chevron for visual parity with
 * the other chip field controls; `ghost` renders the bare toolbar pill instead.
 *
 * `mode='single'` (default) commits on day click. `mode='range'` opens the
 * range calendar — start/end staged behind Clear/Cancel/Apply, with optional
 * time-of-day inputs — and commits via `onRangeChange`.
 *
 * @example
 * <ChipDatePicker value={value} onChange={setValue} placeholder='Select date' fullWidth />
 *
 * @example
 * <ChipDatePicker mode='range' startDate={from} endDate={to} showTime onRangeChange={apply} />
 */
const ChipDatePicker = forwardRef<HTMLButtonElement, ChipDatePickerProps>(
  function ChipDatePicker(props, ref) {
    const {
      variant = 'filled',
      label,
      placeholder = props.mode === 'range' ? 'Select date range' : 'Select date',
      align = 'start',
      disabled,
      fullWidth,
      flush,
      className,
    } = props

    const [open, setOpen] = useState(false)

    const triggerText =
      label ??
      (props.mode === 'range'
        ? formatDateRangeLabel(props.startDate, props.endDate)
        : formatDateLabel(props.value))

    return (
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            ref={ref}
            type='button'
            disabled={disabled}
            className={cn(
              variant === 'ghost'
                ? chipVariants({ fullWidth, flush })
                : cn(chipVariants({ variant: 'filled', fullWidth, flush }), TRIGGER_BORDER_CLASS),
              className
            )}
          >
            <span
              className={cn(
                chipContentLabelClass,
                'flex-1',
                !triggerText && 'text-[var(--text-muted)]'
              )}
            >
              {triggerText || placeholder}
            </span>
            {variant === 'filled' && (
              <span
                aria-hidden
                className='inline-flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]'
              >
                <ChevronDown className='h-[6px] w-[10px]' />
              </span>
            )}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              POPOVER_ANIMATION_CLASSES,
              'z-[var(--z-popover)] origin-[--radix-popover-content-transform-origin] rounded-xl border border-[var(--border-1)] bg-[var(--bg)] shadow-sm'
            )}
          >
            {props.mode === 'range' ? (
              <Calendar
                mode='range'
                startDate={props.startDate}
                endDate={props.endDate}
                showTime={props.showTime}
                onRangeChange={(start, end) => {
                  props.onRangeChange(start, end)
                  setOpen(false)
                }}
                onCancel={() => setOpen(false)}
              />
            ) : (
              <Calendar
                value={props.value}
                onChange={(next) => {
                  props.onChange?.(next)
                  setOpen(false)
                }}
              />
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    )
  }
)

ChipDatePicker.displayName = 'ChipDatePicker'

export { ChipDatePicker }
