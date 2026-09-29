'use client'

/**
 * The multi-line sibling of {@link ChipInput} — a `rounded-lg` filled surface
 * that matches the {@link ChipModal} text fields exactly. Use it for any
 * multi-line field that would otherwise hand-roll the chip chrome (invite
 * messages, credential descriptions, JSON/key blobs) so every textarea on a
 * chip surface reads identically.
 *
 * Like the chip modal fields it shows no focus ring — the surface stays calm.
 * Pass `error` to swap the border to the error token, and `resizable` to allow
 * vertical user resizing (off by default). Control height with `rows` and/or a
 * `min-h-[...]` class.
 *
 * @example
 * ```tsx
 * import { ChipTextarea } from '../../index'
 *
 * <ChipTextarea rows={6} placeholder='Message' value={value} onChange={onChange} error={hasError} />
 * ```
 */
import * as React from 'react'
import { cn } from '../../lib/cn'
import { chipFieldSurfaceClass, chipFieldTextClass } from '../chip/chip-chrome'

export interface ChipTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  /** Marks the field invalid; swaps the border to the error token. */
  error?: boolean
  /** Allows vertical user resizing. Off by default. */
  resizable?: boolean
  /**
   * Renders the textarea as a view-only record: read-only at full opacity with
   * the default cursor instead of the text I-beam. The multi-line counterpart
   * of `ChipCopyInput` — reach for it over `disabled`, which greys the control
   * out.
   * @default false
   */
  viewOnly?: boolean
}

/** Forwards its ref to the underlying `<textarea>`, exactly like a native textarea. */
export const ChipTextarea = React.forwardRef<HTMLTextAreaElement, ChipTextareaProps>(
  ({ className, error, resizable = false, viewOnly = false, readOnly, ...props }, ref) => (
    <textarea
      ref={ref}
      readOnly={viewOnly || readOnly}
      className={cn(
        'w-full px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-50',
        chipFieldSurfaceClass,
        chipFieldTextClass,
        error ? 'border-[var(--text-error)]' : undefined,
        resizable ? 'resize-y' : 'resize-none',
        viewOnly && 'cursor-default',
        className
      )}
      {...props}
    />
  )
)

ChipTextarea.displayName = 'ChipTextarea'
