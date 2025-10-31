'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {}

/**
 * EMCN Label component built on Radix UI Label primitive.
 * Provides consistent typography and styling for form labels.
 *
 * @example
 * ```tsx
 * <Label htmlFor="email">Email Address</Label>
 * ```
 */
function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'inline-flex items-center font-medium text-[#E6E6E6] text-[13px] leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:text-[#E6E6E6]',
        className
      )}
      {...props}
    />
  )
}

Label.displayName = LabelPrimitive.Root.displayName

export { Label }
