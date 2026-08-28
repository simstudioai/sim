'use client'

/**
 * The canonical single-line text input of the chip family — a 30px `rounded-lg`
 * filled surface that matches the {@link ChipModal} text fields and the
 * {@link Chip} pill exactly. Use it for search boxes (settings, integrations),
 * secret/credential value fields, and any standalone labeled input that would
 * otherwise hand-roll the chip chrome with custom classNames.
 *
 * The chrome lives on the wrapper so a leading `icon` and a trailing
 * `endAdornment` (reveal / copy buttons) sit flush next to a transparent inner
 * `<input>`. Matching negative margin and text indent give leading glyphs paint
 * clearance without moving their visual alignment. The leading icon uses the
 * same 1.5 gap as `Chip`. It shares the chip-field chrome with
 * {@link ChipTextarea}, shows no focus ring — keep the surface calm and rely on
 * the caret for focus. Pass `error` to swap the border to the error token.
 *
 * @example
 * ```tsx
 * import { ChipInput, Search } from '../../index'
 *
 * // Search box
 * <ChipInput icon={Search} placeholder='Search...' value={q} onChange={(e) => setQ(e.target.value)} />
 *
 * // Field with a trailing action and an error state
 * <ChipInput value={value} onChange={onChange} error={hasError} endAdornment={<CopyButton />} />
 * ```
 */
import * as React from 'react'
import { cn } from '../../lib/cn'
import { chipFieldSurfaceClass, chipFieldTextClass, chipGeometryClass } from '../chip/chip-chrome'

/**
 * Suppresses the native number spinner.
 *
 * A `type='number'` field is still a chip field: it owns a flat 30px surface with
 * no focus ring, and the browser's stepper paints its own chrome inside it —
 * a bordered double-arrow that belongs to no design token and shifts the value's
 * right edge on hover. Removing it belongs to the component rather than to every
 * caller, or each one re-derives the same three vendor rules by hand.
 *
 * `appearance: textfield` covers Firefox; the WebKit pseudo-elements cover
 * Chrome and Safari, which ignore it.
 */
const NUMBER_SPINNER_RESET =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none'

type ChipInputIcon = React.ComponentType<{ className?: string }>

export interface ChipInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Leading icon component (e.g. `Search` from `@sim/emcn/icons`). Rendered at 14px in `--text-icon`, with the chip's 1.5 gap. */
  icon?: ChipInputIcon
  /** Trailing content rendered after the input (e.g. reveal / copy buttons). */
  endAdornment?: React.ReactNode
  /** Marks the field invalid; swaps the border to the error token. */
  error?: boolean
  /** Class applied to the outer container (the chrome), not the inner input. */
  className?: string
  /** Class applied to the inner `<input>` (e.g. `font-mono`). */
  inputClassName?: string
}

/**
 * Forwards its ref to the inner `<input>` so callers can focus or measure the
 * field directly, exactly like a native input.
 */
export const ChipInput = React.forwardRef<HTMLInputElement, ChipInputProps>(
  (
    {
      className,
      inputClassName,
      icon: Icon,
      endAdornment,
      error,
      disabled,
      type = 'text',
      ...props
    },
    ref
  ) => (
    <div
      className={cn(
        'flex w-full',
        chipGeometryClass,
        chipFieldSurfaceClass,
        error && 'border-[var(--text-error)]',
        disabled && 'opacity-50',
        className
      )}
    >
      {Icon ? <Icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' /> : null}
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          '-ml-1 h-full w-full bg-transparent indent-1 disabled:cursor-not-allowed',
          chipFieldTextClass,
          type === 'number' && NUMBER_SPINNER_RESET,
          inputClassName
        )}
        {...props}
      />
      {endAdornment}
    </div>
  )
)

ChipInput.displayName = 'ChipInput'
