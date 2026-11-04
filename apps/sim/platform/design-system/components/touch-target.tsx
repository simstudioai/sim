import type { ReactElement } from 'react'
import styles from '@/platform/design-system/components/components.module.css'

interface TouchTargetProps {
  children: ReactElement
}

export function TouchTarget({ children }: TouchTargetProps) {
  return <span className={styles.touchTarget}>{children}</span>
}
