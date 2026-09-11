'use client'

import { createContext, type HTMLAttributes, type ReactNode, useContext, useRef } from 'react'
import * as RadioGroup from '@radix-ui/react-radio-group'
import type { VariantProps } from 'class-variance-authority'
import { useScrollEdges } from '../../hooks/use-scroll-edges'
import { cn } from '../../lib/cn'
import { segmentedControlItemVariants, segmentedControlVariants } from '../chip/segmented-control'
import { scrollFadeAttributes, scrollFadeXClass } from '../scroll-fade/scroll-fade'

/** Shared chip chrome; preserves the compound control's existing gap default. */
const chipButtonGroupVariants = ({
  gap = 'sm',
  ...props
}: Parameters<typeof segmentedControlVariants>[0] = {}) =>
  segmentedControlVariants({ gap, ...props })

interface ChipButtonGroupContextValue {
  value: string | undefined
  size: 'default' | 'compact'
}

const ChipButtonGroupContext = createContext<ChipButtonGroupContextValue | null>(null)

function useChipButtonGroupContext() {
  const context = useContext(ChipButtonGroupContext)
  if (!context) {
    throw new Error('ChipButtonGroupItem must be used within a ChipButtonGroup')
  }
  return context
}

export interface ChipButtonGroupProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    VariantProps<typeof chipButtonGroupVariants> {
  /** Currently selected value */
  value?: string
  /** Callback fired when selection changes */
  onValueChange?: (value: string) => void
  /** Disables all items in the group */
  disabled?: boolean
  children: ReactNode
}

/**
 * A 30px segmented chip with compound children for rich option content.
 * Its chrome is shared with `ChipSwitch`. Radix owns radio-group focus,
 * arrow-key selection, and disabled-option behavior.
 *
 * @example
 * ```tsx
 * <ChipButtonGroup value={language} onValueChange={setLanguage}>
 *   <ChipButtonGroupItem value="curl">cURL</ChipButtonGroupItem>
 *   <ChipButtonGroupItem value="python">Python</ChipButtonGroupItem>
 *   <ChipButtonGroupItem value="javascript">JavaScript</ChipButtonGroupItem>
 * </ChipButtonGroup>
 * ```
 */
function ChipButtonGroup({
  className,
  gap,
  size = 'default',
  value,
  onValueChange,
  disabled = false,
  children,
  ...props
}: ChipButtonGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(groupRef, { axis: 'x' })
  return (
    <ChipButtonGroupContext.Provider value={{ value, size: size ?? 'default' }}>
      <RadioGroup.Root
        value={value ?? ''}
        onValueChange={onValueChange}
        disabled={disabled}
        asChild
      >
        <div
          ref={groupRef}
          className={cn(scrollFadeXClass, chipButtonGroupVariants({ gap, size }), className)}
          {...scrollFadeAttributes(edges)}
          {...props}
        >
          {children}
        </div>
      </RadioGroup.Root>
    </ChipButtonGroupContext.Provider>
  )
}

const chipButtonGroupItemVariants = segmentedControlItemVariants

export interface ChipButtonGroupItemProps
  extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Value associated with this item */
  value: string
  /** Disables this specific item */
  disabled?: boolean
}

/**
 * An individual item within a ChipButtonGroup.
 */
function ChipButtonGroupItem({
  className,
  value,
  disabled: itemDisabled,
  children,
  ...props
}: ChipButtonGroupItemProps) {
  const context = useChipButtonGroupContext()
  const isActive = context.value === value
  return (
    <RadioGroup.Item value={value} disabled={itemDisabled} asChild>
      <button
        type='button'
        className={cn(
          chipButtonGroupItemVariants({ active: isActive, size: context.size }),
          className
        )}
        {...props}
      >
        {children}
      </button>
    </RadioGroup.Item>
  )
}

ChipButtonGroup.displayName = 'ChipButtonGroup'
ChipButtonGroupItem.displayName = 'ChipButtonGroupItem'

export {
  ChipButtonGroup,
  ChipButtonGroupItem,
  chipButtonGroupVariants,
  chipButtonGroupItemVariants,
}
