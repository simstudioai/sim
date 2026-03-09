'use client'

import type { ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Button, Plus, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { ResourceHeader } from './components/resource-header'
import type { SortConfig } from './components/resource-options-bar'
import { ResourceOptionsBar } from './components/resource-options-bar'

export interface ResourceColumn {
  id: string
  header: string
}

export interface ResourceCell {
  icon?: ReactNode
  label?: string | null
}

export interface ResourceRow {
  id: string
  cells: Record<string, ResourceCell>
  sortValues?: Record<string, string | number>
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
  defaultSort: string
  toolbarActions?: ReactNode
  columns: ResourceColumn[]
  rows: ResourceRow[]
  onRowClick?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  isLoading?: boolean
  loadingRows?: number
  onContextMenu?: (e: React.MouseEvent) => void
}

const EMPTY_CELL_PLACEHOLDER = '-  -  -'

/**
 * Shared page shell for resource list pages (tables, files, knowledge, schedules).
 * Renders the header, toolbar with search, and a data table from column/row definitions.
 */
export function Resource({
  icon,
  title,
  create,
  search,
  defaultSort,
  toolbarActions,
  columns,
  rows,
  onRowClick,
  onRowContextMenu,
  isLoading,
  loadingRows = 5,
  onContextMenu,
}: ResourceProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: defaultSort,
    direction: 'desc',
  })

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerRef.current) {
      headerRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  const handleSort = useCallback((column: string, direction: 'asc' | 'desc') => {
    setSort({ column, direction })
  }, [])

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: columns.map((col) => ({ id: col.id, label: col.header })),
      active: sort,
      onSort: handleSort,
    }),
    [columns, sort, handleSort]
  )

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const col = sort.column
      const aVal = a.sortValues?.[col] ?? a.cells[col]?.label ?? ''
      const bVal = b.sortValues?.[col] ?? b.cells[col]?.label ?? ''
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal))
      return sort.direction === 'asc' ? -cmp : cmp
    })
  }, [rows, sort])

  return (
    <div
      className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'
      onContextMenu={onContextMenu}
    >
      <ResourceHeader icon={icon} title={title} create={create} />
      <ResourceOptionsBar search={search} sort={sortConfig} toolbarActions={toolbarActions} />

      {isLoading ? (
        <DataTableSkeleton columns={columns} rowCount={loadingRows} />
      ) : (
        <>
          <div ref={headerRef} className='overflow-hidden'>
            <table className='w-full table-fixed text-[13px]'>
              <ResourceColGroup columns={columns} />
              <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
                <tr>
                  {columns.map((col) => {
                    const isActive = sort.column === col.id
                    const SortIcon = sort.direction === 'asc' ? ArrowUp : ArrowDown
                    return (
                      <th key={col.id} className='h-10 px-[16px] py-[6px] text-left align-middle'>
                        <Button
                          variant='subtle'
                          className='px-[8px] py-[4px] font-base text-[var(--text-muted)] hover:text-[var(--text-muted)]'
                          onClick={() =>
                            handleSort(
                              col.id,
                              isActive ? (sort.direction === 'desc' ? 'asc' : 'desc') : 'desc'
                            )
                          }
                        >
                          {col.header}
                          {isActive && (
                            <SortIcon className='ml-[4px] h-[12px] w-[12px] text-[var(--text-icon)]' />
                          )}
                        </Button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
            </table>
          </div>
          <div className='min-h-0 flex-1 overflow-auto' onScroll={handleBodyScroll}>
            <table className='w-full table-fixed text-[13px]'>
              <ResourceColGroup columns={columns} />
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={row.id}
                    data-resource-row
                    className={cn(
                      'transition-colors hover:bg-[var(--surface-3)]',
                      onRowClick && 'cursor-pointer'
                    )}
                    onClick={() => onRowClick?.(row.id)}
                    onContextMenu={(e) => onRowContextMenu?.(e, row.id)}
                  >
                    {columns.map((col, colIdx) => {
                      const cell = row.cells[col.id]
                      return (
                        <td key={col.id} className='px-[24px] py-[10px] align-middle'>
                          <CellContent
                            cell={{ ...cell, label: cell?.label || EMPTY_CELL_PLACEHOLDER }}
                            primary={colIdx === 0}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {create && (
                  <tr
                    className={cn(
                      'transition-colors',
                      create.disabled
                        ? 'cursor-not-allowed'
                        : 'cursor-pointer hover:bg-[var(--surface-3)]'
                    )}
                    onClick={create.disabled ? undefined : create.onClick}
                  >
                    <td colSpan={columns.length} className='px-[24px] py-[10px] align-middle'>
                      <span className='flex items-center gap-[12px] font-medium text-[14px] text-[var(--text-secondary)]'>
                        <Plus className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
                        {create.label}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
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
      {cell.icon && <span className='flex-shrink-0 text-[var(--text-icon)]'>{cell.icon}</span>}
      <span className='truncate'>{cell.label}</span>
    </span>
  )
}

function ResourceColGroup({ columns }: { columns: ResourceColumn[] }) {
  return (
    <colgroup>
      {columns.map((col, colIdx) => (
        <col key={col.id} className={colIdx === 0 ? 'min-w-[200px]' : 'w-[160px]'} />
      ))}
    </colgroup>
  )
}

function DataTableSkeleton({ columns, rowCount }: { columns: ResourceColumn[]; rowCount: number }) {
  return (
    <>
      <div className='overflow-hidden'>
        <table className='w-full table-fixed text-[13px]'>
          <ResourceColGroup columns={columns} />
          <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className='h-10 px-[24px] py-[10px] text-left align-middle font-base text-[var(--text-muted)]'
                >
                  <div className='flex min-h-[20px] items-center'>
                    <Skeleton className='h-[12px] w-[56px]' />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full table-fixed text-[13px]'>
          <ResourceColGroup columns={columns} />
          <tbody>
            {Array.from({ length: rowCount }, (_, i) => (
              <tr key={i}>
                {columns.map((col, colIdx) => (
                  <td key={col.id} className='px-[24px] py-[10px] align-middle'>
                    <span className='flex min-h-[21px] items-center gap-[12px]'>
                      {colIdx === 0 && <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />}
                      <Skeleton className='h-[14px] w-[128px]' />
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
