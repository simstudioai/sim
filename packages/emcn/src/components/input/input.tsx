/**
 * A minimal input component matching the emcn design system.
 *
 * @example
 * ```tsx
 * import { Input } from '../../index'
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
 * For chip-styled surfaces use {@link ChipInput} instead.
 */
import * as React from 'react'
import { cn } from '../../lib/cn'

const INPUT_CLASS =
  'flex w-full touch-manipulation rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 font-medium font-sans text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed disabled:opacity-50 scroll-pr-1'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** Minimal input component matching the textarea styling. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return <input type={type} className={cn(INPUT_CLASS, className)} ref={ref} {...props} />
  }
)

Input.displayName = 'Input'

export { Input }
