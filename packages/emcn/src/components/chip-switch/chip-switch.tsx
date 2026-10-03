'use client'

import { type ComponentType, type ReactNode, useRef } from 'react'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { useScrollEdges } from '../../hooks/use-scroll-edges'
import { cn } from '../../lib/cn'
import { segmentedControlItemVariants, segmentedControlVariants } from '../chip/segmented-control'
import { scrollFadeAttributes, scrollFadeXClass } from '../scroll-fade/scroll-fade'

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
  /** Disables this option without changing the current selection. */
  disabled?: boolean
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
  /** Disables every option while preserving the current selection. */
  disabled?: boolean
  /** Compact controls use a 22px outer height for dense settings rows. */
  size?: 'default' | 'compact'
  /** Optional accessible label for the radio group. */
  'aria-label'?: string
  /** Extra classes merged onto the outer container. */
  className?: string
}

/**
 * A segmented chip with the same 30px outer height as `ChipDropdown`. Its
 * inset segments share their chrome with `ChipButtonGroup`. Radix owns radio-group
 * focus, arrow-key selection, and disabled-option behavior.
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
  disabled = false,
  size = 'default',
  'aria-label': ariaLabel,
  className,
}: ChipSwitchProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(groupRef, { axis: 'x' })
  return (
    <RadioGroup.Root
      ref={groupRef}
      {...scrollFadeAttributes(edges)}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find((entry) => entry.value === next)
        if (!disabled && option && !option.disabled) onChange(option.value)
      }}
      aria-label={ariaLabel}
      className={cn(scrollFadeXClass, segmentedControlVariants({ size }), className)}
    >
      {options.map((option) => {
        const Icon = option.icon
        const isActive = option.value === value
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(segmentedControlItemVariants({ active: isActive, size }))}
          >
            {Icon ? <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' /> : null}
            {option.label}
          </RadioGroup.Item>
        )
      })}
    </RadioGroup.Root>
  )
}
