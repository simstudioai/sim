import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

const textareaVariants = cva(
  'flex w-full touch-manipulation rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-2 font-medium font-sans text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] outline-none focus-visible:border-[var(--text-muted)] resize-none overflow-auto disabled:cursor-not-allowed disabled:opacity-50',
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

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

/**
 * Minimal textarea component matching the user-input styling.
 * Features a resize handle in the bottom right corner.
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
