import type React from 'react'
import { useId } from 'react'
import { cn, Label } from '@sim/emcn'

/**
 * Ids and ARIA wiring a field mints for its control. Spread onto the control
 * element so the label, the error/hint line, and the input stay associated
 * without the consumer minting ids of its own.
 */
/**
 * The workflow editor's subblock label row, verbatim. `justify-between` looks
 * idle on a field with nothing but a label in it, and is kept anyway: it is
 * the editor's own row, and matching it verbatim is what keeps the two panels
 * from drifting a pixel apart.
 */
const LABEL_ROW_CLASS = 'flex items-center justify-between gap-1.5 pl-0.5'

/**
 * The row for a field nested inside a `CollapsibleCard`.
 *
 * `pl-2` rather than the panel's `pl-0.5`: a chip trigger indents its own text
 * by `px-2`, so a label sitting at the card body's edge starts 8px to the LEFT
 * of the control it names. Matching the chip's inset puts the label directly
 * above the control's text, which is the relationship EMCN's modal fields have.
 */
const FLUSH_LABEL_ROW_CLASS = 'flex items-center justify-between gap-1.5 pl-2'

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
  /** Drops the label's optical indent — for a field nested inside a card. */
  flush?: boolean
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
 * Labelled field row for the interfaces inspector.
 *
 * Matches the workflow editor's subblock rhythm exactly — `gap-2.5` from the
 * label row to the control, `pl-0.5` on the row rather than the label, and a
 * `FieldDivider` between siblings — so the two properties panels read as one
 * surface. Only the label's colour differs, and deliberately: this panel keeps
 * its muted, normal-weight label.
 *
 * The horizontal gutter belongs to the surrounding scroll well, so this row
 * carries no padding of its own.
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
  flush = false,
  children,
}: InspectorFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const rowClass = flush ? FLUSH_LABEL_ROW_CLASS : LABEL_ROW_CLASS
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
      className='flex items-baseline gap-1.5 whitespace-nowrap font-normal text-[var(--text-muted)]'
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
    <div className={cn('flex flex-col', flush ? 'gap-[9px]' : 'gap-2.5')}>
      <div className={rowClass}>{label}</div>
      {control}
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
