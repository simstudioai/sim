import type { ReactElement } from 'react'
import styles from '#emcn/components/touch-target/touch-target.module.css'

interface TouchTargetProps {
  children: ReactElement
}

export function TouchTarget({ children }: TouchTargetProps) {
  return <span className={styles.touchTarget}>{children}</span>
}
