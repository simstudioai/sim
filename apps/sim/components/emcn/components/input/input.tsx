/**
 * A minimal input component matching the emcn design system.
 *
 * @example
 * ```tsx
 * import { Input } from '@/components/emcn'
 *
 * // Basic usage
 * <Input placeholder="Enter text..." />
 *
 * // Controlled input
 * <Input value={value} onChange={(e) => setValue(e.target.value)} />
 *
 * // Disabled state
 * <Input disabled placeholder="Cannot edit" />
 * ```
 *
 * @see inputVariants for available styling variants
 */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Input component.
 * Currently supports a 'default' variant.
 */
const inputVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] py-[6px] font-medium font-sans text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

/**
 * Props for the Input component.
 * Extends native input attributes with variant support.
 */
export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

/**
 * Minimal input component matching the textarea styling.
 * Uses consistent emcn design patterns.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input, inputVariants }
