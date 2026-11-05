'use client'

import { Button } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/pagination/pagination.module.css'

interface PaginationProps {
  label: string
  /** The current page, counting from 1. */
  page: number
  /** Leave out when the server only reports whether another page exists. */
  pageCount?: number
  hasNext?: boolean
  disabled?: boolean
  onPageChange: (page: number) => void
}

export function Pagination({
  label,
  page,
  pageCount,
  hasNext = pageCount !== undefined && page < pageCount,
  disabled,
  onPageChange,
}: PaginationProps) {
  return (
    <nav className={styles.pagination} aria-label={label}>
      <Button
        variant='quiet'
        size='compact'
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <span className={styles.position} data-type='T060' aria-live='polite'>
        {pageCount === undefined ? `Page ${page}` : `Page ${page} of ${pageCount}`}
      </span>
      <Button
        variant='quiet'
        size='compact'
        disabled={disabled || !hasNext}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
