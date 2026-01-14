/**
 * Loading skeleton for table rows.
 *
 * @module tables/[tableId]/table-data-viewer/components/loading-rows
 */

import { TableCell, TableRow } from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
import type { ColumnDefinition } from '@/lib/table'

interface LoadingRowsProps {
  columns: ColumnDefinition[]
}

/**
 * Renders skeleton rows while table data is loading.
 *
 * @param props - Component props
 * @returns Loading skeleton rows
 */
export function LoadingRows({ columns }: LoadingRowsProps) {
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
          <TableCell>
            <div className='flex gap-[4px]'>
              <Skeleton className='h-[24px] w-[24px]' />
              <Skeleton className='h-[24px] w-[24px]' />
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}
