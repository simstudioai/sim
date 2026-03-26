'use client'

import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Switch root element.
 *
 * @remarks
 * Supports multiple sizes:
 * - **sm** - Compact switch (14px height) for dense UIs like tables
 * - **md** - Default switch (20px height)
 * - **lg** - Larger switch (24px height) for prominent toggles
 */
const switchVariants = cva(
  'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full bg-[var(--border-1)] transition-colors before:absolute before:inset-[-12px] before:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] data-[disabled]:cursor-not-allowed data-[state=checked]:bg-[var(--text-primary)] data-[disabled]:opacity-50',
  {
    variants: {
      size: {
        sm: 'h-3.5 w-6',
        md: 'h-5 w-9',
        lg: 'h-6 w-11',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
)

/**
 * Variant styles for the Switch thumb element.
 */
const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-[var(--surface-2)] shadow-sm ring-0 transition-transform',
  {
    variants: {
      size: {
        sm: 'h-2.5 w-2.5 data-[state=checked]:translate-x-[11px] data-[state=unchecked]:translate-x-0.5',
        md: 'h-4 w-4 data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5',
        lg: 'h-5 w-5 data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
)

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {}

/**
 * Switch component styled to match Sim's design system.
 * Uses brand color for checked state, neutral border for unchecked.
 *
 * @example
 * ```tsx
 * // Default size
 * <Switch checked={value} onCheckedChange={setValue} />
 *
 * // Small size for tables
 * <Switch size="sm" checked={value} onCheckedChange={setValue} />
 *
 * // Large size
 * <Switch size="lg" checked={value} onCheckedChange={setValue} />
 * ```
 */
const Switch = React.memo(
  React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
    ({ className, size, disabled, ...props }, ref) => (
      <SwitchPrimitives.Root
        disabled={disabled}
        className={cn(switchVariants({ size }), className)}
        {...props}
        ref={ref}
      >
        <SwitchPrimitives.Thumb className={cn(switchThumbVariants({ size }))} />
      </SwitchPrimitives.Root>
    )
  )
)

Switch.displayName = 'Switch'

export { Switch, switchVariants, switchThumbVariants }
