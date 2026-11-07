import type { ReactNode } from 'react'
import { FieldFrame } from '@sim/emcn/field'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/requests/requests.module.css'

interface RequestTextProps {
  label: string
  children: ReactNode
}

/** A labeled read-only value inside a request dialog. Multi-line text keeps its line breaks. */
export function RequestText({ label, children }: RequestTextProps) {
  return (
    <FieldFrame label={label}>
      <p className={styles.text} data-type='T060'>
        {children}
      </p>
    </FieldFrame>
  )
}
