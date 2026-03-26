'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Label component.
 *
 * @remarks
 * Supports size variants for different contexts:
 * - **sm** - Compact labels for dense forms (11px)
 * - **md** - Default label size (13px)
 * - **lg** - Larger labels for prominent form sections (15px)
 */
const labelVariants = cva(
  'inline-flex items-center font-medium text-[var(--text-primary)] leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'text-xs',
        md: 'text-small',
        lg: 'text-base',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
)

export interface LabelProps
  extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {
  /** Displays a red asterisk after the label text */
  required?: boolean
}

/**
 * EMCN Label component built on Radix UI Label primitive.
 *
 * @remarks
 * Provides consistent typography and styling for form labels.
 * Automatically handles disabled states through peer-disabled CSS.
 *
 * @example
 * ```tsx
 * // Default label
 * <Label htmlFor="email">Email Address</Label>
 *
 * // Required label with asterisk
 * <Label htmlFor="name" required>Full Name</Label>
 *
 * // Small label
 * <Label size="sm">Caption label</Label>
 * ```
 */
function Label({ className, size, required, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root className={cn(labelVariants({ size }), className)} {...props}>
      {children}
      {required ? <span className='ml-0.5 text-[var(--text-error)]'>*</span> : null}
    </LabelPrimitive.Root>
  )
}

Label.displayName = LabelPrimitive.Root.displayName

export { Label, labelVariants }
