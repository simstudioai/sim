import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/_components/control-bar/control-bar.module.css'

interface ControlBarProps {
  /** The page's search, filling the leading edge. */
  search?: ReactNode
  /** A choice or label on the leading edge, at its text width as Home's period is. */
  leading?: ReactNode
  /** Filters, sort, status text and actions, toward the trailing edge. */
  children?: ReactNode
}

/**
 * The compact row beneath a page's heading or tabs: page-level actions and the choices that shape
 * the content below. Its controls extend by the row inset, so their text meets the content edge.
 */
export function ControlBar({ search, leading, children }: ControlBarProps) {
  return (
    <div className={styles.controls}>
      {(search || leading) && (
        <div className={styles.leading}>
          {search && <div className={styles.search}>{search}</div>}
          {leading}
        </div>
      )}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  )
}
