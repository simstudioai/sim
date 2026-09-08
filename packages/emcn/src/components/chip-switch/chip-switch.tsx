'use client'

import type { ComponentType, ReactNode } from 'react'
import * as RadioGroup from '@radix-ui/react-radio-group'
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
  options: readonly ChipSwitchOption<T>[]
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
 * The trough is pinned to `w-fit` so it always hugs its segments: `inline-flex`
 * alone does not survive a flex column, where `align-items: stretch` blockifies
 * the container and pulls it edge to edge. A caller-supplied width class still
 * wins through {@link cn}.
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
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((entry) => entry.value === next)
        if (option) onChange(option.value)
      }}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-fit items-center rounded-[10px] bg-[var(--surface-5)] p-[2px] dark:bg-[var(--surface-4)]',
        className
      )}
    >
      {options.map((option) => {
        const Icon = option.icon
        const isActive = option.value === value
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              chipVariants({
                variant: isActive ? 'border-shadow' : 'default',
              }),
              'justify-center',
              isActive
                ? 'text-[var(--text-primary)] shadow-none hover-hover:bg-[var(--surface-2)] dark:bg-[var(--surface-6)] dark:shadow-none dark:hover-hover:bg-[var(--surface-6)]'
                : 'text-[var(--text-muted)] hover-hover:bg-transparent hover-hover:text-[var(--text-primary)]'
            )}
          >
            {Icon ? <Icon className='size-[14px] shrink-0' /> : null}
            {option.label}
          </RadioGroup.Item>
        )
      })}
    </RadioGroup.Root>
  )
}
