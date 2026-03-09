'use client'

import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '@/lib/core/utils/cn'

/**
 * Switch component styled to match Sim's design system.
 * Uses brand color for checked state, neutral border for unchecked.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, disabled, ...props }, ref) => (
  <SwitchPrimitives.Root
    disabled={disabled}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-[var(--border-1)] transition-colors focus-visible:outline-none data-[disabled]:cursor-not-allowed data-[state=checked]:bg-[var(--brand-tertiary-2)] data-[disabled]:opacity-50',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb className='pointer-events-none block h-4 w-4 rounded-full bg-[var(--white)] shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5' />
  </SwitchPrimitives.Root>
))

Switch.displayName = 'Switch'

export { Switch }
