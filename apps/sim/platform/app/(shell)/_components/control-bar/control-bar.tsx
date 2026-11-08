import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/_components/control-bar/control-bar.module.css'

interface ControlBarProps {
  /** Search, or the page's primary choice, on the content's leading edge. */
  leading?: ReactNode
  /** Filters, sort, status text and actions, toward the trailing edge. */
  children?: ReactNode
}

/**
 * The compact row beneath a page's heading or tabs: page-level actions and the choices that shape
 * the content below. Its controls extend by the row inset, so their text meets the content edge.
 */
export function ControlBar({ leading, children }: ControlBarProps) {
  return (
    <div className={styles.controls}>
      {leading && <div className={styles.leading}>{leading}</div>}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  )
}
