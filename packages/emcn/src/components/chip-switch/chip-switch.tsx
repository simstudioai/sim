'use client'

import type { ComponentType, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { chipVariants } from '../chip/chip'

/**
 * One segment in a {@link ChipSwitch}. `label` accepts a `ReactNode` so callers
 * can render colored accents (e.g. a discount badge) inline.
 */
export interface ChipSwitchOption<T extends string = string> {
  /** The value associated with this option — passed to `onChange` on select. */
  value: T
  /** Visible label content; `ReactNode` allows inline badges or colored spans. */
  label: ReactNode
  /** Optional leading icon rendered before the label. */
  icon?: ComponentType<{ className?: string }>
}

/**
 * Props for {@link ChipSwitch}.
 */
export interface ChipSwitchProps<T extends string = string> {
  /** Ordered list of options to render as segments. */
  options: ChipSwitchOption<T>[]
  /** Currently selected value. */
  value: T
  /** Invoked with the next selection when a segment is clicked. */
  onChange: (value: T) => void
  /** Optional accessible label for the radio group. */
  'aria-label'?: string
  /** Extra classes merged onto the outer container. */
  className?: string
}

/**
 * A pill-shaped segmented switch built from the chip language: each segment is
 * a {@link chipVariants}-styled button — `border-shadow` when active, `ghost`
 * when not — so text size, padding, height, and rounding match {@link Chip}
 * exactly. The active segment is a flat lifted surface against the trough
 * (`--surface-2` light / `--surface-6` dark, no shadow) for a clean, even pill.
 *
 * @example
 * <ChipSwitch
 *   value={view}
 *   onChange={setView}
 *   options={[
 *     { value: 'annual', label: <>Annual<Badge>-20%</Badge></> },
 *     { value: 'monthly', label: 'Monthly' },
 *   ]}
 * />
 */
export function ChipSwitch<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: ChipSwitchProps<T>) {
  return (
    <div
      role='radiogroup'
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-[10px] bg-[var(--surface-5)] p-[2px] dark:bg-[var(--surface-4)]',
        className
      )}
    >
      {options.map((option) => {
        const Icon = option.icon
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={isActive}
            data-state={isActive ? 'on' : 'off'}
            onClick={() => onChange(option.value)}
            className={cn(
              chipVariants({
                variant: isActive ? 'border-shadow' : 'default',
                flush: true,
              }),
              'justify-center',
              isActive
                ? 'text-[var(--text-primary)] shadow-none hover-hover:bg-[var(--surface-2)] dark:bg-[var(--surface-6)] dark:shadow-none dark:hover-hover:bg-[var(--surface-6)]'
                : 'text-[var(--text-muted)] hover-hover:bg-transparent hover-hover:text-[var(--text-primary)]'
            )}
          >
            {Icon ? <Icon className='size-[14px] flex-shrink-0' /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
