import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/field/details-field.module.css'
import { FieldFrame } from '@/platform/design-system/components/field/fields'

interface DetailsFieldProps {
  label: string
  children: ReactNode
}

/** Labeled read-only information, including structured properties, inside a form. */
export function DetailsField({ label, children }: DetailsFieldProps) {
  return (
    <FieldFrame label={label}>
      <div className={styles.value} data-type='T060'>
        {children}
      </div>
    </FieldFrame>
  )
}
