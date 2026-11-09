import type { ReactNode } from 'react'
import styles from '@/app/(product)/_components/control-bar/control-bar.module.css'

interface ControlBarProps {
  /** The page's search, filling the leading edge, or keeping a field's width beside a trail. */
  search?: ReactNode
  /** Where the reader is: the breadcrumb trail, to the right of search. */
  trail?: ReactNode
  /** A choice or label on the leading edge, at its text width as Home's period is. */
  leading?: ReactNode
  /** Filters, sort, status text and actions, toward the trailing edge. */
  children?: ReactNode
}

/**
 * The compact row beneath a page's heading or tabs: page-level actions and the choices that shape
 * the content below. Like the tabs above it, its controls sit inside the column.
 */
export function ControlBar({ search, trail, leading, children }: ControlBarProps) {
  return (
    <div className={styles.controls}>
      {(search || trail || leading) && (
        <div className={styles.leading} data-trail={trail ? '' : undefined}>
          {search && <div className={styles.search}>{search}</div>}
          {trail && <div className={styles.trail}>{trail}</div>}
          {leading}
        </div>
      )}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  )
}
