import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const inputVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)] px-[8px] py-[6px] font-medium font-sans text-sm text-foreground transition-colors placeholder:text-[var(--text-muted)] dark:placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
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
