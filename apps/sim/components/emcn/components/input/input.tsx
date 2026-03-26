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
 *
 * @remarks
 * Supports visual variants for different contexts:
 * - **default** - Standard bordered input with surface background
 * - **error** - Red-tinted border and focus ring for validation errors
 * - **ghost** - Transparent background, border only on focus/hover
 */
const inputVariants = cva(
  'flex w-full touch-manipulation rounded-sm border font-medium font-sans text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-[var(--border-1)] bg-[var(--surface-5)] focus-visible:border-[var(--text-muted)]',
        error:
          'border-[var(--text-error)] bg-[var(--surface-5)] focus-visible:border-[var(--text-error)]',
        ghost:
          'border-transparent bg-transparent hover-hover:bg-[var(--surface-4)] focus-visible:border-[var(--border-1)] focus-visible:bg-[var(--surface-5)]',
      },
      size: {
        sm: 'px-1.5 py-1 text-caption',
        md: 'px-2 py-1.5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

/**
 * Props for the Input component.
 * Extends native input attributes with variant support.
 */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

/**
 * Minimal input component matching the textarea styling.
 * Uses consistent emcn design patterns.
 *
 * @example
 * ```tsx
 * // Error state
 * <Input variant="error" placeholder="Invalid value" />
 *
 * // Ghost variant (transparent until focused)
 * <Input variant="ghost" placeholder="Inline edit..." />
 *
 * // Small size
 * <Input size="sm" placeholder="Compact input" />
 * ```
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input, inputVariants }
