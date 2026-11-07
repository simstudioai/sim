import type { LabelHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/field/field.module.css'

interface AuthLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {}
/** Labels the control identified by htmlFor; feedback association belongs to AuthField. */
export function AuthLabel({ className, htmlFor, children, ...props }: AuthLabelProps) {
  return (
    <label {...props} htmlFor={htmlFor} className={clsx(styles.label, className)}>
      {children}
    </label>
  )
}

interface AuthFieldProps {
  htmlFor: string
  label: string
  errors?: string[]
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
}
/** Connects a label and feedback to a child whose id equals htmlFor.
 * AuthInput with error=true references the generated `${htmlFor}-errors` region.
 * Callers supplying a hint include `${htmlFor}-hint` in the input's aria-describedby. */
export function AuthField({ htmlFor, label, errors, hint, action, children }: AuthFieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && (
        <div id={`${htmlFor}-hint`} className={styles.caption}>
          {hint}
        </div>
      )}
      {Boolean(errors?.length) && (
        <div id={`${htmlFor}-errors`} className={styles.fieldErrors} aria-live='polite'>
          {errors?.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </div>
  )
}
