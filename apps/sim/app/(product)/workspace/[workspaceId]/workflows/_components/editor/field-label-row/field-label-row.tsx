'use client'

import type { ReactNode } from 'react'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/field-label-row/field-label-row.module.css'

interface FieldLabelRowProps {
  /** The field's caption, with anything that follows it, such as a required mark. */
  label: ReactNode
  /** The control the caption names, which a click on the caption focuses. */
  htmlFor?: string
  /** Compact actions at the row's end. */
  actions?: ReactNode
}

/**
 * A field's caption with compact actions at its end, such as Generate or a selector swap. The row
 * holds a 24px action on the caption's 18px line, so a row with actions sits where a bare caption does.
 */
export function FieldLabelRow({ label, htmlFor, actions }: FieldLabelRowProps) {
  return (
    <div className={styles.row}>
      {htmlFor ? (
        <label className={styles.label} htmlFor={htmlFor} data-type='T059'>
          {label}
        </label>
      ) : (
        <span className={styles.label} data-type='T059'>
          {label}
        </span>
      )}
      {actions && <span className={styles.actions}>{actions}</span>}
    </div>
  )
}

interface ActionFieldProps extends FieldLabelRowProps {
  children: ReactNode
}

/** A labelled control whose caption carries actions; a field without actions uses `FieldFrame`. */
export function ActionField({ label, htmlFor, actions, children }: ActionFieldProps) {
  return (
    <div className={styles.field}>
      <FieldLabelRow label={label} htmlFor={htmlFor} actions={actions} />
      {children}
    </div>
  )
}
