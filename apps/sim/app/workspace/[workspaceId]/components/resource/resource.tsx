'use client'

import type { ReactNode } from 'react'
import { useCallback, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { ResourceHeader } from './components/resource-header'
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
  const headerRef = useRef<HTMLDivElement>(null)

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerRef.current) {
      headerRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  return (
    <div
      className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'
      onContextMenu={onContextMenu}
    >
      <ResourceHeader icon={icon} title={title} create={create} />
      <ResourceOptionsBar
        search={search}
        onSort={onSort}
        onFilter={onFilter}
        toolbarActions={toolbarActions}
      />

      {isLoading ? (
        <DataTableSkeleton columns={columns} rowCount={loadingRows} />
      ) : (
        <>
          <div ref={headerRef} className='overflow-hidden'>
            <table className='w-full table-fixed text-[13px]'>
              <ResourceColGroup columns={columns} />
              <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.id}
                      className='h-10 px-[24px] py-[10px] text-left align-middle font-base text-[var(--text-muted)]'
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <div className='min-h-0 flex-1 overflow-auto' onScroll={handleBodyScroll}>
            <table className='w-full table-fixed text-[13px]'>
              <ResourceColGroup columns={columns} />
              <tbody>
                {rows.map((row) => (
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
      {cell.icon && <span className='flex-shrink-0 text-[var(--text-subtle)]'>{cell.icon}</span>}
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
