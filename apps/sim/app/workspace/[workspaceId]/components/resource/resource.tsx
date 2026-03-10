'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ArrowDown, ArrowUp, Button, Checkbox, Loader, Plus, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { BreadcrumbItem, CreateAction, HeaderAction } from './components/resource-header'
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

export interface SelectableConfig {
  selectedIds: Set<string>
  onSelectRow: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  isAllSelected: boolean
  disabled?: boolean
}

export interface PaginationConfig {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

interface ResourceProps {
  icon: React.ElementType
  title: string
  breadcrumbs?: BreadcrumbItem[]
  create?: CreateAction
  search?: SearchConfig
  defaultSort?: string
  disableHeaderSort?: boolean
  sort?: SortConfig
  headerActions?: HeaderAction[]
  columns: ResourceColumn[]
  rows: ResourceRow[]
  selectedRowId?: string | null
  selectable?: SelectableConfig
  onRowClick?: (rowId: string) => void
  onRowHover?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  isLoading?: boolean
  loadingRows?: number
  onContextMenu?: (e: React.MouseEvent) => void
  filter?: ReactNode
  filterTags?: FilterTag[]
  extras?: ReactNode
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
  pagination?: PaginationConfig
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
  breadcrumbs,
  create,
  search,
  defaultSort,
  disableHeaderSort,
  sort: sortOverride,
  headerActions,
  columns,
  rows,
  selectedRowId,
  selectable,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  isLoading,
  loadingRows = 5,
  onContextMenu,
  filter,
  filterTags,
  extras,
  onLoadMore,
  hasMore,
  isLoadingMore,
  pagination,
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
    if (!sortEnabled || sortOverride) return rows
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
  }, [rows, sort, sortEnabled, sortOverride])

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

  const hasCheckbox = selectable != null
  const totalColSpan = columns.length + (hasCheckbox ? 1 : 0)

  return (
    <div
      className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'
      onContextMenu={onContextMenu}
    >
      <ResourceHeader
        icon={icon}
        title={title}
        breadcrumbs={breadcrumbs}
        create={create}
        actions={headerActions}
      />
      <ResourceOptionsBar
        search={search}
        sort={sortOverride ?? sortConfig}
        filter={filter}
        filterTags={filterTags}
        extras={extras}
      />

      {contentOverride ? (
        <div className='min-h-0 flex-1 overflow-auto'>{contentOverride}</div>
      ) : isLoading ? (
        <DataTableSkeleton columns={columns} rowCount={loadingRows} hasCheckbox={hasCheckbox} />
      ) : rows.length === 0 && emptyMessage ? (
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <span className='text-[13px] text-[var(--text-secondary)]'>{emptyMessage}</span>
        </div>
      ) : (
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          <div ref={headerRef} className='overflow-hidden'>
            <table className='w-full table-fixed text-[13px]'>
              <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
              <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
                <tr>
                  {hasCheckbox && (
                    <th className='h-10 w-[52px] py-[6px] pr-0 pl-[20px] text-left align-middle'>
                      <Checkbox
                        size='sm'
                        checked={selectable.isAllSelected}
                        onCheckedChange={(checked) => selectable.onSelectAll(checked as boolean)}
                        disabled={selectable.disabled}
                        aria-label='Select all'
                      />
                    </th>
                  )}
                  {columns.map((col) => {
                    if (disableHeaderSort || !sortEnabled) {
                      return (
                        <th
                          key={col.id}
                          className='h-10 px-[24px] py-[6px] text-left align-middle font-base text-[12px] text-[var(--text-muted)]'
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
              <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
              <tbody>
                {displayRows.map((row) => {
                  const isSelected = selectable?.selectedIds.has(row.id) ?? false
                  return (
                    <tr
                      key={row.id}
                      data-resource-row
                      data-row-id={row.id}
                      className={cn(
                        'transition-colors hover:bg-[var(--surface-3)]',
                        onRowClick && 'cursor-pointer',
                        (selectedRowId === row.id || isSelected) && 'bg-[var(--surface-3)]'
                      )}
                      onClick={() => onRowClick?.(row.id)}
                      onMouseEnter={onRowHover ? () => onRowHover(row.id) : undefined}
                      onContextMenu={(e) => onRowContextMenu?.(e, row.id)}
                    >
                      {hasCheckbox && (
                        <td className='w-[52px] py-[10px] pr-0 pl-[20px] align-middle'>
                          <Checkbox
                            size='sm'
                            checked={isSelected}
                            onCheckedChange={(checked) =>
                              selectable.onSelectRow(row.id, checked as boolean)
                            }
                            disabled={selectable.disabled}
                            aria-label='Select row'
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                      )}
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
                  )
                })}
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
                    <td colSpan={totalColSpan} className='px-[24px] py-[10px] align-middle'>
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
          {pagination && pagination.totalPages > 1 && (
            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={pagination.onPageChange}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className='flex items-center justify-center border-[var(--border)] border-t bg-[var(--bg)] px-4 py-[10px]'>
      <div className='flex items-center gap-1'>
        <Button
          variant='ghost'
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className='h-3.5 w-3.5' />
        </Button>
        <div className='mx-[12px] flex items-center gap-[16px]'>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let page: number
            if (totalPages <= 5) {
              page = i + 1
            } else if (currentPage <= 3) {
              page = i + 1
            } else if (currentPage >= totalPages - 2) {
              page = totalPages - 4 + i
            } else {
              page = currentPage - 2 + i
            }
            if (page < 1 || page > totalPages) return null
            return (
              <button
                key={page}
                type='button'
                onClick={() => onPageChange(page)}
                className={cn(
                  'font-medium text-sm transition-colors hover:text-foreground',
                  page === currentPage ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {page}
              </button>
            )
          })}
        </div>
        <Button
          variant='ghost'
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          <ChevronRight className='h-3.5 w-3.5' />
        </Button>
      </div>
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

function ResourceColGroup({
  columns,
  hasCheckbox,
}: {
  columns: ResourceColumn[]
  hasCheckbox?: boolean
}) {
  return (
    <colgroup>
      {hasCheckbox && <col className='w-[52px]' />}
      {columns.map((col, colIdx) => (
        <col key={col.id} className={colIdx === 0 ? 'min-w-[200px]' : 'w-[160px]'} />
      ))}
    </colgroup>
  )
}

function DataTableSkeleton({
  columns,
  rowCount,
  hasCheckbox,
}: {
  columns: ResourceColumn[]
  rowCount: number
  hasCheckbox?: boolean
}) {
  return (
    <>
      <div className='overflow-hidden'>
        <table className='w-full table-fixed text-[13px]'>
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
            <tr>
              {hasCheckbox && (
                <th className='h-10 w-[52px] py-[10px] pr-0 pl-[20px] text-left align-middle'>
                  <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
                </th>
              )}
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
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <tbody>
            {Array.from({ length: rowCount }, (_, i) => (
              <tr key={i}>
                {hasCheckbox && (
                  <td className='w-[52px] py-[10px] pr-0 pl-[20px] align-middle'>
                    <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
                  </td>
                )}
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
