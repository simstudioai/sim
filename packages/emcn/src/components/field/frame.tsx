import { type ComponentProps, cloneElement, type ReactElement, type ReactNode } from 'react'
import styles from '#emcn/components/field/field.shared.module.css'
import { CountedLabel } from '#emcn/components/overflow-text/counted-label'

export interface FieldFrameProps {
  id?: string
  label: string
  count?: number
  optional?: boolean
  error?: string
  hint?: string
  /** Name the control for assistive technology only, where its context labels it visually. */
  labelHidden?: boolean
  labelRender?: ReactElement<
    ComponentProps<'div'> & { 'data-type'?: string; 'data-visually-hidden'?: boolean }
  >
  children: ReactNode
}

/** The `aria-describedby` for a control whose frame was given this `error` and `hint`. */
export function fieldDescription(id: string, error?: string, hint?: string) {
  const parts = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

export function FieldFrame({
  id,
  label,
  count,
  optional,
  error,
  hint,
  labelHidden,
  labelRender,
  children,
}: FieldFrameProps) {
  const caption = (
    <>
      {count === undefined ? label : <CountedLabel label={label} count={count} />}
      {optional && (
        <span className={styles.optional} data-type='T060'>
          {' '}
          (optional)
        </span>
      )}
    </>
  )
  return (
    <div className={styles.field}>
      {labelRender ? (
        cloneElement(labelRender, {
          'data-visually-hidden': labelHidden || undefined,
          'data-type': 'T059',
          children: caption,
        })
      ) : id ? (
        <label htmlFor={id} data-visually-hidden={labelHidden || undefined} data-type='T059'>
          {caption}
        </label>
      ) : (
        <span data-visually-hidden={labelHidden || undefined} data-type='T059'>
          {caption}
        </span>
      )}
      {children}
      {hint && (
        <span id={id ? `${id}-hint` : undefined} className={styles.hint} data-type='T052'>
          {hint}
        </span>
      )}
      {error && (
        <span id={id ? `${id}-error` : undefined} className={styles.error} data-type='T052'>
          {error}
        </span>
      )}
    </div>
  )
}
