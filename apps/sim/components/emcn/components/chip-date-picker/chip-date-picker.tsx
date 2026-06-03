'use client'

import { forwardRef, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Calendar, formatDateLabel } from '@/components/emcn/components/calendar/calendar'
import { chipVariants, TRIGGER_BORDER_CLASS } from '@/components/emcn/components/chip/chip'
import { POPOVER_ANIMATION_CLASSES } from '@/components/emcn/components/popover/popover-animation'
import { ChevronDown } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

export interface ChipDatePickerProps {
  /** Selected date as a `YYYY-MM-DD` string. */
  value?: string
  /** Called with the picked date in `YYYY-MM-DD` format. */
  onChange?: (value: string) => void
  /** Shown in the trigger when no date is selected. */
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

/**
 * Date counterpart to {@link ChipDropdown} — a chip-styled trigger that opens a
 * {@link Calendar} in a popover. The trigger reuses `chipVariants` (filled +
 * border) and the owned chevron for visual parity with the other chip controls.
 *
 * @example
 * <ChipDatePicker value={value} onChange={setValue} placeholder='Select date' fullWidth />
 */
const ChipDatePicker = forwardRef<HTMLButtonElement, ChipDatePickerProps>(function ChipDatePicker(
  {
    value,
    onChange,
    placeholder = 'Select date',
    align = 'start',
    disabled,
    fullWidth,
    flush,
    className,
  },
  ref
) {
  const [open, setOpen] = useState(false)
  const label = formatDateLabel(value)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          ref={ref}
          type='button'
          disabled={disabled}
          className={cn(
            chipVariants({ variant: 'filled', fullWidth, flush }),
            TRIGGER_BORDER_CLASS,
            className
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              label ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
            )}
          >
            {label || placeholder}
          </span>
          <span
            aria-hidden
            className='inline-flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]'
          >
            <ChevronDown className='h-[6px] w-[10px]' />
          </span>
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
          <Calendar
            value={value}
            onChange={(next) => {
              onChange?.(next)
              setOpen(false)
            }}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
})

ChipDatePicker.displayName = 'ChipDatePicker'

export { ChipDatePicker }
