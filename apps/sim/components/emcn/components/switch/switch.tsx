'use client'

import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '@/lib/core/utils/cn'

/**
 * Custom switch component with thin track design.
 * Track: 28px width, 6px height, 20px border-radius
 * Thumb: 14px diameter circle that overlaps the track
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, disabled, ...props }, ref) => (
  <SwitchPrimitives.Root
    disabled={disabled}
    className={cn(
      'peer inline-flex h-[17px] w-[30px] shrink-0 cursor-pointer items-center rounded-[20px] transition-colors focus-visible:outline-none',
      'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
      'bg-[var(--border-1)] data-[state=checked]:bg-[var(--text-primary)]',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-[14px] w-[14px] rounded-full shadow-sm ring-0 transition-transform',
        'bg-[var(--white)]',
        'data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-[2px]'
      )}
    />
  </SwitchPrimitives.Root>
))

Switch.displayName = 'Switch'

export { Switch }
