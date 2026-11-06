import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/page-column/page-column.module.css'

interface PageColumnProps {
  children: ReactNode
}

/** The shared text edge, including when a Platform view surrounds an embedded host composer. */
export function PageColumn({ children }: PageColumnProps) {
  return <div className={styles.column}>{children}</div>
}

/** Extends a surface's hit area around the column's text edge. */
export function PageOverflow({ children }: PageColumnProps) {
  return <div className={styles.overflow}>{children}</div>
}
