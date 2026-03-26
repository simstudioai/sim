import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Textarea component.
 *
 * @remarks
 * Supports visual variants for different contexts:
 * - **default** - Standard bordered textarea with surface background
 * - **error** - Red-tinted border for validation errors
 * - **ghost** - Transparent background, border only on focus/hover
 */
const textareaVariants = cva(
  'flex w-full touch-manipulation rounded-sm border px-2 py-2 font-medium font-sans text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] outline-none resize-none overflow-auto disabled:cursor-not-allowed disabled:opacity-50',
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
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

/**
 * Minimal textarea component matching the user-input styling.
 *
 * @example
 * ```tsx
 * // Error state
 * <Textarea variant="error" placeholder="Invalid value" />
 *
 * // Ghost variant (transparent until focused)
 * <Textarea variant="ghost" placeholder="Inline edit..." />
 * ```
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <textarea className={cn(textareaVariants({ variant }), className)} ref={ref} {...props} />
    )
  }
)

Textarea.displayName = 'Textarea'

export { Textarea, textareaVariants }
