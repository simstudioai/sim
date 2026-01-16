/**
 * Table body placeholder states (loading and empty).
 */

import { Plus } from 'lucide-react'
import { Button, TableCell, TableRow } from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
import type { ColumnDefinition } from '@/lib/table'

interface TableLoadingRowsProps {
  columns: ColumnDefinition[]
}

/**
 * Renders skeleton rows while table data is loading.
 */
export function TableLoadingRows({ columns }: TableLoadingRowsProps) {
  return (
    <>
      {Array.from({ length: 25 }).map((_, rowIndex) => (
        <TableRow key={rowIndex}>
          <TableCell>
            <Skeleton className='h-[14px] w-[14px]' />
          </TableCell>
          {columns.map((col, colIndex) => {
            const baseWidth =
              col.type === 'json'
                ? 200
                : col.type === 'string'
                  ? 160
                  : col.type === 'number'
                    ? 80
                    : col.type === 'boolean'
                      ? 50
                      : col.type === 'date'
                        ? 100
                        : 120
            const variation = ((rowIndex + colIndex) % 3) * 20
            const width = baseWidth + variation

            return (
              <TableCell key={col.name}>
                <Skeleton className='h-[16px]' style={{ width: `${width}px` }} />
              </TableCell>
            )
          })}
        </TableRow>
      ))}
    </>
  )
}

interface TableEmptyRowsProps {
  columnCount: number
  hasFilter: boolean
  onAddRow: () => void
}

/**
 * Renders an empty state when no rows are present.
 */
export function TableEmptyRows({ columnCount, hasFilter, onAddRow }: TableEmptyRowsProps) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount + 1} className='h-[160px]'>
        <div className='fixed left-1/2 -translate-x-1/2'>
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
        </div>
      </TableCell>
    </TableRow>
  )
}
