'use client'

import type { ReactNode } from 'react'
import { ArrowUpDown, ListFilter, Plus, Search } from 'lucide-react'
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface ResourceColumn {
  id: string
  header: string
}

export interface ResourceCell {
  icon?: ReactNode
  label: string
}

export interface ResourceRow {
  id: string
  cells: Record<string, ResourceCell>
}

interface ResourceProps {
  icon: React.ElementType
  title: string
  create?: {
    label: string
    onClick: () => void
    disabled?: boolean
  }
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
  onSort?: () => void
  onFilter?: () => void
  toolbarActions?: ReactNode
  columns: ResourceColumn[]
  rows: ResourceRow[]
  onRowClick?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  isLoading?: boolean
  loadingRows?: number
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * Shared page shell for resource list pages (tables, files, knowledge, schedules).
 * Renders the header, toolbar with search, and a data table from column/row definitions.
 */
export function Resource({
  icon: Icon,
  title,
  create,
  search,
  onSort,
  onFilter,
  toolbarActions,
  columns,
  rows,
  onRowClick,
  onRowContextMenu,
  isLoading,
  loadingRows = 5,
  onContextMenu,
}: ResourceProps) {
  const hasOptionsBar = search || onSort || onFilter
  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div
          className='flex flex-1 flex-col overflow-auto bg-white dark:bg-[var(--bg)]'
          onContextMenu={onContextMenu}
        >
          <div className='border-[var(--border)] border-b px-[24px] py-[10px]'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-[12px]'>
                <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
                <h1 className='font-medium text-[14px] text-[var(--text-body)]'>{title}</h1>
              </div>
              {create && (
                <Button
                  onClick={create.onClick}
                  disabled={create.disabled}
                  variant='subtle'
                  className='px-[8px] py-[4px] text-[12px]'
                >
                  <Plus className='mr-[6px] h-[14px] w-[14px]' />
                  {create.label}
                </Button>
              )}
            </div>
          </div>

          {hasOptionsBar && (
            <div className='border-[var(--border)] border-b px-[24px] py-[10px]'>
              <div className='flex items-center justify-between'>
                {search && (
                  <div className='relative flex-1'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-0 h-[14px] w-[14px] text-[var(--text-muted)]' />
                    <input
                      type='text'
                      value={search.value}
                      onChange={(e) => search.onChange(e.target.value)}
                      placeholder={search.placeholder ?? 'Search...'}
                      className='w-full bg-transparent py-[4px] pl-[24px] font-base text-[12px] text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-subtle)]'
                    />
                  </div>
                )}
                <div className='flex items-center gap-[6px]'>
                  {onFilter && (
                    <Button
                      variant='subtle'
                      className='px-[8px] py-[4px] text-[12px]'
                      onClick={onFilter}
                    >
                      <ListFilter className='mr-[6px] h-[14px] w-[14px]' />
                      Filter
                    </Button>
                  )}
                  {onSort && (
                    <Button
                      variant='subtle'
                      className='px-[8px] py-[4px] text-[12px]'
                      onClick={onSort}
                    >
                      <ArrowUpDown className='mr-[6px] h-[14px] w-[14px]' />
                      Sort
                    </Button>
                  )}
                  {toolbarActions}
                </div>
              </div>
            </div>
          )}

          <div className='flex min-h-0 flex-1 flex-col'>
            {isLoading ? (
              <DataTableSkeleton columns={columns} rowCount={loadingRows} />
            ) : (
              <Table className='table-fixed text-[13px]'>
                <TableHeader>
                  <TableRow className='hover:bg-transparent'>
                    {columns.map((col, colIdx) => (
                      <TableHead
                        key={col.id}
                        className={cn(
                          colIdx === 0 ? 'min-w-[400px]' : 'w-[160px]',
                          'px-[24px] py-[10px] font-base text-[var(--text-muted)]'
                        )}
                      >
                        {col.header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-resource-row
                      className={cn(
                        onRowClick && 'cursor-pointer',
                        'border-b-0 bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                      )}
                      onClick={() => onRowClick?.(row.id)}
                      onContextMenu={(e) => onRowContextMenu?.(e, row.id)}
                    >
                      {columns.map((col, colIdx) => {
                        const cell = row.cells[col.id]
                        if (!cell) {
                          return <TableCell key={col.id} className='px-[24px] py-[10px]' />
                        }
                        return (
                          <TableCell key={col.id} className='px-[24px] py-[10px]'>
                            <CellContent cell={cell} primary={colIdx === 0} />
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                  {create && (
                    <TableRow
                      className={cn(
                        'border-b-0',
                        create.disabled
                          ? 'opacity-40'
                          : 'cursor-pointer hover:bg-[var(--surface-3)]'
                      )}
                      onClick={create.disabled ? undefined : create.onClick}
                    >
                      <TableCell colSpan={columns.length} className='px-[24px] py-[10px]'>
                        <span className='flex items-center gap-[12px] font-medium text-[14px] text-[var(--text-secondary)]'>
                          <Plus className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
                          {create.label}
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CellContent({ cell, primary }: { cell: ResourceCell; primary?: boolean }) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-[12px] font-medium text-[14px]',
        primary ? 'text-[var(--text-body)]' : 'text-[var(--text-secondary)]'
      )}
    >
      {cell.icon && <span className='flex-shrink-0 text-[var(--text-subtle)]'>{cell.icon}</span>}
      <span className='truncate'>{cell.label}</span>
    </span>
  )
}

function DataTableSkeleton({ columns, rowCount }: { columns: ResourceColumn[]; rowCount: number }) {
  return (
    <Table className='table-fixed text-[13px]'>
      <TableHeader>
        <TableRow className='hover:bg-transparent'>
          {columns.map((col, colIdx) => (
            <TableHead
              key={col.id}
              className={cn(
                colIdx === 0 ? 'min-w-[400px]' : 'w-[160px]',
                'px-[24px] py-[10px] font-base text-[var(--text-muted)]'
              )}
            >
              <div className='flex min-h-[20px] items-center'>
                <Skeleton className='h-[12px] w-[56px]' />
              </div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rowCount }, (_, i) => (
          <TableRow key={i} className='border-b-0 hover:bg-transparent'>
            {columns.map((col, colIdx) => (
              <TableCell key={col.id} className='px-[24px] py-[10px]'>
                <span className='flex min-h-[21px] items-center gap-[12px]'>
                  {colIdx === 0 && <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />}
                  <Skeleton className='h-[14px] w-[128px]' />
                </span>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
