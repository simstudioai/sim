import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/settings-section/settings-section.module.css'

interface RowListProps {
  children: ReactNode
  /** A divider between rows, tighter, for a list read as one block rather than a stack of links. */
  dividers?: boolean
  label?: string
}

/**
 * A list of rows whose hover fill reaches past the content column, so their text stays aligned with
 * the headings and fields around them.
 */
export function RowList({ children, dividers, label }: RowListProps) {
  return (
    <ul className={styles.rowList} data-dividers={dividers || undefined} aria-label={label}>
      {children}
    </ul>
  )
}
