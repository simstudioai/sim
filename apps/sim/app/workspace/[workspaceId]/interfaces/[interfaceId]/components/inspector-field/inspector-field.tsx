import type React from 'react'
import { useId } from 'react'
import { Label } from '@sim/emcn'

/**
 * Ids and ARIA wiring a field mints for its control. Spread onto the control
 * element so the label, the error/hint line, and the input stay associated
 * without the consumer minting ids of its own.
 */
export interface InspectorFieldControl {
  id: string
  'aria-required': true | undefined
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

export interface InspectorFieldProps {
  /** Field title rendered in the muted label row. */
  title: React.ReactNode
  /** Appends the required marker to the title and sets `aria-required`. */
  required?: boolean
  /** Takes precedence over `hint`. */
  error?: React.ReactNode
  hint?: React.ReactNode
  /**
   * `inline` puts the control on the title's row — the switch layout. The
   * error/hint line still renders beneath the row.
   */
  orientation?: 'stacked' | 'inline'
  /**
   * A function child marks the control as labelable: the field mints an id,
   * points its `<label>` at it, and hands back the matching ARIA props.
   *
   * Pass a plain node for controls a `<label>` cannot target — `ChipCombobox`
   * and `ChipSelect` render `div[role="combobox"]` — and give those an
   * `aria-label` instead.
   */
  children: React.ReactNode | ((control: InspectorFieldControl) => React.ReactNode)
}

/**
 * Labelled field row for the interfaces module — used by the inspector's
 * config sections and by the rendered form module, so a field a builder edits
 * and the field a visitor fills are the same chrome.
 *
 * Mirrors `ChipModalField`'s rhythm — muted, normal-weight label, `gap-[9px]`
 * to the control, `text-caption` hint or error beneath — because neither
 * surface is inside a `ChipModal` and therefore cannot use `ChipModalField`
 * itself. The horizontal gutter belongs to the surrounding scroll well, so this
 * row carries no padding of its own.
 *
 * @example
 * ```tsx
 * <InspectorField title='Welcome message' hint='Shown before the first message.'>
 *   {(control) => <ChipTextarea rows={3} value={message} onChange={onChange} {...control} />}
 * </InspectorField>
 * ```
 */
export function InspectorField({
  title,
  required,
  error,
  hint,
  orientation = 'stacked',
  children,
}: InspectorFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const labelable = typeof children === 'function'
  const control = labelable
    ? children({
        id,
        'aria-required': required || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : hint ? hintId : undefined,
      })
    : children

  const label = (
    <Label
      htmlFor={labelable ? id : undefined}
      className='pl-0.5 font-normal text-[var(--text-muted)]'
    >
      {title}
      {required && (
        <span aria-hidden className='ml-0.5 text-[var(--text-error)]'>
          *
        </span>
      )}
    </Label>
  )

  return (
    <div className='flex flex-col gap-[9px]'>
      {orientation === 'inline' ? (
        <div className='flex items-center justify-between gap-3'>
          {label}
          {control}
        </div>
      ) : (
        <>
          {label}
          {control}
        </>
      )}
      {error ? (
        <p id={errorId} role='alert' className='text-[var(--text-error)] text-caption'>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className='text-[var(--text-muted)] text-caption'>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
