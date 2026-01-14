/**
 * Empty state component for table rows.
 *
 * @module tables/[tableId]/table-data-viewer/components/empty-rows
 */

import { Plus } from 'lucide-react'
import { Button, TableCell, TableRow } from '@/components/emcn'

interface EmptyRowsProps {
  columnCount: number
  hasFilter: boolean
  onAddRow: () => void
}

/**
 * Renders an empty state when no rows are present.
 *
 * @param props - Component props
 * @returns Empty state row
 */
export function EmptyRows({ columnCount, hasFilter, onAddRow }: EmptyRowsProps) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount + 2} className='h-[160px] text-center'>
        <div className='flex flex-col items-center gap-[12px]'>
          <span className='text-[13px] text-[var(--text-tertiary)]'>
            {hasFilter ? 'No rows match your filter' : 'No data'}
          </span>
          {!hasFilter && (
            <Button variant='default' size='sm' onClick={onAddRow}>
              <Plus className='mr-[4px] h-[12px] w-[12px]' />
              Add first row
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
