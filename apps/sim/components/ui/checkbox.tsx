'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded-sm border border-[var(--surface-11)] bg-[var(--surface-5)] ring-offset-background transition-colors hover:border-[var(--surface-14)] hover:bg-[var(--surface-6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--surface-14)] data-[state=checked]:bg-[var(--surface-11)] data-[state=checked]:text-[var(--text-primary)] dark:border-[var(--surface-11)] dark:bg-[var(--surface-9)] dark:data-[state=checked]:border-[var(--surface-15)] dark:data-[state=checked]:bg-[var(--surface-13)] dark:hover:border-[var(--surface-13)] dark:hover:bg-[var(--surface-11)]',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
      <Check className='h-3.5 w-3.5 stroke-[3]' />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
