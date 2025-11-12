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
        'inline-flex items-center font-medium text-[13px] text-[var(--text-primary)] leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:text-[var(--text-primary)]',
        className
      )}
      {...props}
    />
  )
}

Label.displayName = LabelPrimitive.Root.displayName

export { Label }
