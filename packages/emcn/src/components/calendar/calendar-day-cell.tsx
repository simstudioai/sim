'use client'

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { chipVariants } from '../chip/chip'

export interface CalendarDayCellProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Strong `primary` fill — the selected calendar day or an active weekday toggle. */
  selected?: boolean
  /** The `border` shadow-ring marking today. Ignored while `selected`. */
  today?: boolean
  /**
   * Fills the container width (the weekday-toggle row) instead of the fixed
   * 30px square used by the calendar's month grid.
   */
  fullWidth?: boolean
  children: ReactNode
}

/**
 * The single day pill shared by the {@link Calendar} month grid and any
 * chip-aligned day toggle (e.g. the scheduled-task weekly "Repeat on" row).
 * Built from `chipVariants` so the chrome — height, radius, centered glyph,
 * `primary` selected fill, `border` today ring — lives in one place and the
 * row of weekday toggles reads as a sibling of the date picker rather than a
 * separate control.
 *
 * @example
 * <CalendarDayCell selected={isSelected} today={isToday} onClick={pick}>{day}</CalendarDayCell>
 *
 * @example
 * // Weekday toggle: fill the column, drive selection with `aria-pressed`.
 * <CalendarDayCell selected={on} fullWidth aria-pressed={on} aria-label='Monday' onClick={toggle}>M</CalendarDayCell>
 */
export const CalendarDayCell = forwardRef<HTMLButtonElement, CalendarDayCellProps>(
  function CalendarDayCell(
    { selected = false, today = false, fullWidth = false, className, children, type, ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn(
          chipVariants({
            variant: selected ? 'primary' : today ? 'border' : undefined,
            flush: true,
          }),
          'justify-center p-0',
          fullWidth ? 'h-[30px] w-full' : 'size-[30px]',
          !selected && 'text-[var(--text-body)]',
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)
