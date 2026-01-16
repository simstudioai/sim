/**
 * Pagination controls for the table.
 */

import { Button } from '@/components/emcn'

interface TablePaginationProps {
  currentPage: number
  totalPages: number
  totalCount: number
  onPreviousPage: () => void
  onNextPage: () => void
}

/**
 * Renders pagination controls for navigating table pages.
 *
 * @param props - Component props
 * @returns Table pagination controls or null if only one page
 */
export function TablePagination({
  currentPage,
  totalPages,
  totalCount,
  onPreviousPage,
  onNextPage,
}: TablePaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className='flex h-[40px] shrink-0 items-center justify-between border-[var(--border)] border-t px-[16px]'>
      <span className='text-[11px] text-[var(--text-tertiary)]'>
        Page {currentPage + 1} of {totalPages} ({totalCount} rows)
      </span>
      <div className='flex items-center gap-[4px]'>
        <Button variant='ghost' size='sm' onClick={onPreviousPage} disabled={currentPage === 0}>
          Previous
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={onNextPage}
          disabled={currentPage === totalPages - 1}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
