import * as React from 'react'
import { cn } from '../../lib/cn'

/** `[letter-spacing:inherit]` — see the note on `INPUT_CLASS`; keep the two in step. */
const TEXTAREA_CLASS =
  'flex w-full touch-manipulation rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-2 font-sans text-sm text-[var(--text-primary)] [letter-spacing:inherit] transition-colors placeholder:text-[var(--text-muted)] outline-hidden resize-none overflow-auto disabled:cursor-not-allowed disabled:opacity-50'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * Native editing foundation for caret mirrors and specialized editors.
 * Use ChipTextarea for ordinary form fields.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return <textarea className={cn(TEXTAREA_CLASS, className)} ref={ref} {...props} />
  }
)

Textarea.displayName = 'Textarea'

export { Textarea }
