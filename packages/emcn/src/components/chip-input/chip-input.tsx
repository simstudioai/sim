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
 * `appearance='compactSearch'` owns the existing 23px code-search field
 * treatment without changing the 30px chip default.
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
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import {
  chipContentGeometryClass,
  chipFieldSurfaceClass,
  chipFieldTextClass,
  chipRadiusClass,
  chipSizeClasses,
} from '../chip/chip-chrome'

type ChipInputIcon = React.ComponentType<{ className?: string }>

/** The compact search field keeps the existing code-viewer input geometry. */
export const chipInputVariants = cva('', {
  variants: {
    appearance: {
      chip: '',
      compactSearch: `${chipFieldSurfaceClass} h-[23px] items-center rounded-sm px-2 dark:bg-[var(--surface-5)]`,
    },
  },
  defaultVariants: { appearance: 'chip' },
})

export interface ChipInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof chipInputVariants> {
  /** The default chip field or the compact code-search field. */
  appearance?: VariantProps<typeof chipInputVariants>['appearance']
  /** Control height for the standard chip appearance: 30px by default, or 36px for auth fields. */
  size?: keyof typeof chipSizeClasses
  /** Leading icon component (e.g. `Search` from `@sim/emcn/icons`). Rendered at 14px in `--text-icon`, with the chip's 1.5 gap. */
  icon?: ChipInputIcon
  /** Custom leading content, such as a color swatch. Takes precedence over `icon`. */
  startAdornment?: React.ReactNode
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
      appearance = 'chip',
      className,
      inputClassName,
      icon: Icon,
      startAdornment,
      endAdornment,
      error,
      disabled,
      type = 'text',
      size = 'md',
      ...props
    },
    ref
  ) => (
    <div
      className={cn(
        'flex w-full',
        appearance === 'chip' && chipContentGeometryClass,
        appearance === 'chip' && chipRadiusClass,
        appearance === 'chip' && chipSizeClasses[size],
        appearance === 'chip' && chipFieldSurfaceClass,
        chipInputVariants({ appearance }),
        error && 'border-[var(--text-error)]',
        disabled && 'opacity-50',
        className
      )}
    >
      {startAdornment ??
        (Icon ? <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' /> : null)}
      <input
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          appearance === 'compactSearch'
            ? 'h-full w-full touch-manipulation scroll-pr-1 bg-transparent font-sans text-[var(--text-primary)] text-caption outline-hidden [letter-spacing:inherit] placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed'
            : cn(
                '-ml-1 h-full w-full bg-transparent indent-1 disabled:cursor-not-allowed',
                chipFieldTextClass
              ),
          inputClassName
        )}
        {...props}
      />
      {endAdornment}
    </div>
  )
)

ChipInput.displayName = 'ChipInput'
