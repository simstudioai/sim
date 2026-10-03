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

/**
 * `[letter-spacing:inherit]` undoes the UA stylesheet, which resets form controls
 * to `letter-spacing: normal`. Two reasons it matters: input text otherwise tracks
 * differently from every label beside it, and a transparent-input-over-mirror
 * overlay (the sub-block editors) diverges from its mirror by the inherited
 * tracking on every character — so the caret drifts further from the text the
 * longer the value. Keep this in step with `Textarea`.
 */
const INPUT_CLASS =
  'flex w-full touch-manipulation rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 font-sans text-sm text-[var(--text-primary)] [letter-spacing:inherit] transition-colors placeholder:text-[var(--text-muted)] outline-hidden disabled:cursor-not-allowed disabled:opacity-50 scroll-pr-1'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** Minimal input component matching the textarea styling. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return <input type={type} className={cn(INPUT_CLASS, className)} ref={ref} {...props} />
  }
)

Input.displayName = 'Input'

export { Input }
