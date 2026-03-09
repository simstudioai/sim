'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/core/utils/cn'

export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {}

/**
 * EMCN Label component built on Radix UI Label primitive.
 *
 * @remarks
 * Provides consistent typography and styling for form labels.
 * Automatically handles disabled states through peer-disabled CSS.
 *
 * @param className - Additional CSS classes to apply
 * @param props - Additional props passed to the Radix Label primitive
 * @returns The styled label element
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
        'inline-flex items-center font-medium text-[13px] text-[var(--text-primary)] leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

Label.displayName = LabelPrimitive.Root.displayName

export { Label }
