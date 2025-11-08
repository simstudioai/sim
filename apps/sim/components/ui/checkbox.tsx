'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-4 w-4 shrink-0 rounded-sm border border-[#3D3D3D] bg-[#272727] ring-offset-background transition-colors hover:border-[#4A4A4A] hover:bg-[#282828] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[#4A4A4A] data-[state=checked]:bg-[#3D3D3D] data-[state=checked]:text-[#E6E6E6] dark:border-[#3D3D3D] dark:bg-[#363636] dark:data-[state=checked]:border-[#5A5A5A] dark:data-[state=checked]:bg-[#454545] dark:hover:border-[#454545] dark:hover:bg-[#3D3D3D]',
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
