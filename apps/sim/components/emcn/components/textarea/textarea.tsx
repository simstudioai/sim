import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const textareaVariants = cva(
  'flex w-full rounded-[4px] border border-[#3D3D3D] bg-[#282828] dark:bg-[#363636] px-[8px] py-[8px] font-medium font-sans text-sm text-foreground transition-colors placeholder:text-[#787878] dark:placeholder:text-[#787878] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 resize overflow-auto disabled:cursor-not-allowed disabled:opacity-50',
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
