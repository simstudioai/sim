'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Button, Loader, Plus, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { CreateAction, HeaderAction } from './components/resource-header'
import { ResourceHeader } from './components/resource-header'
import type { FilterTag, SearchConfig, SortConfig } from './components/resource-options-bar'
import { ResourceOptionsBar } from './components/resource-options-bar'

export interface ResourceColumn {
  id: string
  header: string
}

export interface ResourceCell {
  icon?: ReactNode
  label?: string | null
  content?: ReactNode
}

export interface ResourceRow {
  id: string
  cells: Record<string, ResourceCell>
  sortValues?: Record<string, string | number>
}

interface ResourceProps {
  icon: React.ElementType
  title: string
  create?: CreateAction
  search?: SearchConfig
  defaultSort?: string
  disableHeaderSort?: boolean
  headerActions?: HeaderAction[]
  columns: ResourceColumn[]
  rows: ResourceRow[]
  selectedRowId?: string | null
  onRowClick?: (rowId: string) => void
  onRowHover?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  isLoading?: boolean
  loadingRows?: number
  onContextMenu?: (e: React.MouseEvent) => void
  filter?: ReactNode
  filterTags?: FilterTag[]
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
  emptyMessage?: string
  contentOverride?: ReactNode
  overlay?: ReactNode
}

const EMPTY_CELL_PLACEHOLDER = '-  -  -'

/**
 * Shared page shell for resource list pages (tables, files, knowledge, schedules, logs).
 * Renders the header, toolbar with search, and a data table from column/row definitions.
 */
export function Resource({
  icon,
  title,
  create,
  search,
  defaultSort,
  disableHeaderSort,
  headerActions,
  columns,
  rows,
  selectedRowId,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  isLoading,
  loadingRows = 5,
  onContextMenu,
  filter,
  filterTags,
  onLoadMore,
  hasMore,
  isLoadingMore,
  emptyMessage,
  contentOverride,
  overlay,
}: ResourceProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const sortEnabled = defaultSort != null && !disableHeaderSort
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: defaultSort ?? '',
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

  const sortConfig = useMemo<SortConfig | undefined>(() => {
    if (!sortEnabled) return undefined
    return {
      options: columns.map((col) => ({ id: col.id, label: col.header })),
      active: sort,
      onSort: handleSort,
    }
  }, [sortEnabled, columns, sort, handleSort])

  const displayRows = useMemo(() => {
    if (!sortEnabled) return rows
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
  }, [rows, sort, sortEnabled])

  useEffect(() => {
    if (!onLoadMore || !hasMore) return
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onLoadMore, hasMore])

  return (
    <div
      className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'
      onContextMenu={onContextMenu}
    >
      <ResourceHeader icon={icon} title={title} create={create} actions={headerActions} />
      <ResourceOptionsBar
        search={search}
        sort={sortConfig}
        filter={filter}
        filterTags={filterTags}
      />

      {contentOverride ? (
        <div className='min-h-0 flex-1 overflow-auto'>{contentOverride}</div>
      ) : isLoading ? (
        <DataTableSkeleton columns={columns} rowCount={loadingRows} />
      ) : rows.length === 0 && emptyMessage ? (
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <span className='text-[13px] text-[var(--text-secondary)]'>{emptyMessage}</span>
        </div>
      ) : (
        <div className='relative min-h-0 flex-1 overflow-hidden'>
          <div ref={headerRef} className='overflow-hidden'>
            <table className='w-full table-fixed text-[13px]'>
              <ResourceColGroup columns={columns} />
              <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
                <tr>
                  {columns.map((col) => {
                    if (disableHeaderSort || !sortEnabled) {
                      return (
                        <th
                          key={col.id}
                          className='h-10 px-[24px] py-[6px] text-left align-middle font-base text-[var(--text-muted)]'
                        >
                          {col.header}
                        </th>
                      )
                    }
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
                {displayRows.map((row) => (
                  <tr
                    key={row.id}
                    data-resource-row
                    data-row-id={row.id}
                    className={cn(
                      'transition-colors hover:bg-[var(--surface-3)]',
                      onRowClick && 'cursor-pointer',
                      selectedRowId === row.id && 'bg-[var(--surface-3)]'
                    )}
                    onClick={() => onRowClick?.(row.id)}
                    onMouseEnter={onRowHover ? () => onRowHover(row.id) : undefined}
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
            {hasMore && (
              <div ref={loadMoreRef} className='flex items-center justify-center py-[12px]'>
                {isLoadingMore && (
                  <Loader className='h-[16px] w-[16px] text-[var(--text-secondary)]' animate />
                )}
              </div>
            )}
          </div>
          {overlay}
        </div>
      )}
    </div>
  )
}

function CellContent({ cell, primary }: { cell: ResourceCell; primary?: boolean }) {
  if (cell.content) return <>{cell.content}</>
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
