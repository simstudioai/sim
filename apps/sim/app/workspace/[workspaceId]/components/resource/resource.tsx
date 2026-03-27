'use client'
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ArrowDown, ArrowUp, Button, Checkbox, Loader, Plus, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { BreadcrumbItem, CreateAction, HeaderAction } from './components/resource-header'
import { ResourceHeader } from './components/resource-header'
import type { FilterTag, SearchConfig, SortConfig } from './components/resource-options-bar'
import { ResourceOptionsBar } from './components/resource-options-bar'

const CREATE_ROW_PLUS_ICON = <Plus className='h-[14px] w-[14px] text-[var(--text-subtle)]' />

export interface ResourceColumn {
  id: string
  header: string
  widthMultiplier?: number
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
  onContextMenu?: (e: React.MouseEvent) => void
  filter?: ReactNode
  filterTags?: FilterTag[]
  extras?: ReactNode
  pagination?: PaginationConfig
  emptyMessage?: string
  overlay?: ReactNode
}

const EMPTY_CELL_PLACEHOLDER = '-  -  -'
const SKELETON_ROW_COUNT = 5

const stopPropagation = (e: React.MouseEvent) => e.stopPropagation()

/**
 * Shared page shell for resource list pages (tables, files, knowledge, schedules, logs).
 * Renders the header, toolbar with search, and a data table from column/row definitions.
 */
export const Resource = memo(function Resource({
  icon,
  title,
  breadcrumbs,
  create,
  search,
  defaultSort,
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
  onContextMenu,
  filter,
  filterTags,
  extras,
  pagination,
  emptyMessage,
  overlay,
}: ResourceProps) {
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
        sort={sortOverride ?? undefined}
        filter={filter}
        filterTags={filterTags}
        extras={extras}
      />
      <ResourceTable
        columns={columns}
        rows={rows}
        defaultSort={defaultSort}
        sort={sortOverride}
        selectedRowId={selectedRowId}
        selectable={selectable}
        onRowClick={onRowClick}
        onRowHover={onRowHover}
        onRowContextMenu={onRowContextMenu}
        isLoading={isLoading}
        create={create}
        pagination={pagination}
        emptyMessage={emptyMessage}
        overlay={overlay}
      />
    </div>
  )
})

export interface ResourceTableProps {
  columns: ResourceColumn[]
  rows: ResourceRow[]
  defaultSort?: string
  sort?: SortConfig
  selectedRowId?: string | null
  selectable?: SelectableConfig
  onRowClick?: (rowId: string) => void
  onRowHover?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  isLoading?: boolean
  create?: CreateAction
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
  pagination?: PaginationConfig
  emptyMessage?: string
  overlay?: ReactNode
}

/**
 * Data table body extracted from Resource for independent composition.
 * Use directly when rendering a table without the Resource header/toolbar.
 */
export const ResourceTable = memo(function ResourceTable({
  columns,
  rows,
  defaultSort,
  sort: externalSort,
  selectedRowId,
  selectable,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  isLoading,
  create,
  onLoadMore,
  hasMore,
  isLoadingMore,
  pagination,
  emptyMessage,
  overlay,
}: ResourceTableProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const sortEnabled = defaultSort != null
  const [internalSort, setInternalSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: defaultSort ?? '',
    direction: 'desc',
  })

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerRef.current) {
      headerRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  const handleSort = useCallback((column: string, direction: 'asc' | 'desc') => {
    setInternalSort({ column, direction })
  }, [])

  const displayRows = useMemo(() => {
    if (!sortEnabled || externalSort) return rows
    return [...rows].sort((a, b) => {
      const col = internalSort.column
      const aVal = a.sortValues?.[col] ?? a.cells[col]?.label ?? ''
      const bVal = b.sortValues?.[col] ?? b.cells[col]?.label ?? ''
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal))
      return internalSort.direction === 'asc' ? -cmp : cmp
    })
  }, [rows, internalSort, sortEnabled, externalSort])

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

  const handleSelectAll = useCallback(
    (checked: boolean | 'indeterminate') => {
      selectable?.onSelectAll(checked as boolean)
    },
    [selectable]
  )

  if (isLoading) {
    return (
      <DataTableSkeleton
        columns={columns}
        rowCount={SKELETON_ROW_COUNT}
        hasCheckbox={hasCheckbox}
      />
    )
  }

  if (rows.length === 0 && emptyMessage) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center'>
        <span className='text-[var(--text-secondary)] text-small'>{emptyMessage}</span>
      </div>
    )
  }

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div ref={headerRef} className='overflow-hidden'>
        <table className='w-full table-fixed text-small'>
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
            <tr>
              {hasCheckbox && (
                <th className='h-10 w-[52px] py-1.5 pr-0 pl-5 text-left align-middle'>
                  <Checkbox
                    size='sm'
                    checked={selectable.isAllSelected}
                    onCheckedChange={handleSelectAll}
                    disabled={selectable.disabled}
                    aria-label='Select all'
                  />
                </th>
              )}
              {columns.map((col) => {
                if (!sortEnabled) {
                  return (
                    <th
                      key={col.id}
                      className='h-10 px-6 py-1.5 text-left align-middle font-base text-[var(--text-muted)] text-caption'
                    >
                      {col.header}
                    </th>
                  )
                }
                const isActive = internalSort.column === col.id
                const SortIcon = internalSort.direction === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th key={col.id} className='h-10 px-4 py-1.5 text-left align-middle'>
                    <Button
                      variant='subtle'
                      className='px-2 py-1 font-base text-[var(--text-muted)] hover-hover:text-[var(--text-muted)]'
                      onClick={() =>
                        handleSort(
                          col.id,
                          isActive ? (internalSort.direction === 'desc' ? 'asc' : 'desc') : 'desc'
                        )
                      }
                    >
                      {col.header}
                      {isActive && (
                        <SortIcon className='ml-1 h-[12px] w-[12px] text-[var(--text-icon)]' />
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
        <table className='w-full table-fixed text-small'>
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <tbody>
            {displayRows.map((row) => (
              <DataRow
                key={row.id}
                row={row}
                columns={columns}
                selectedRowId={selectedRowId}
                selectable={selectable}
                onRowClick={onRowClick}
                onRowHover={onRowHover}
                onRowContextMenu={onRowContextMenu}
                hasCheckbox={hasCheckbox}
              />
            ))}
            {create && <CreateRow create={create} totalColSpan={totalColSpan} />}
          </tbody>
        </table>
        {hasMore && (
          <div ref={loadMoreRef} className='flex items-center justify-center py-3'>
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
  )
})

const Pagination = memo(function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className='flex items-center justify-center border-[var(--border)] border-t bg-[var(--bg)] px-4 py-2.5'>
      <div className='flex items-center gap-1'>
        <Button
          variant='ghost'
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className='h-3.5 w-3.5' />
        </Button>
        <div className='mx-3 flex items-center gap-4'>
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
                  'font-medium text-sm transition-colors hover-hover:text-[var(--text-body)]',
                  page === currentPage ? 'text-[var(--text-body)]' : 'text-[var(--text-secondary)]'
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
})

interface CellContentProps {
  icon?: ReactNode
  label: string
  content?: ReactNode
  primary?: boolean
}

const CellContent = memo(function CellContent({ icon, label, content, primary }: CellContentProps) {
  if (content) return <>{content}</>
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-3 font-medium text-sm',
        primary ? 'text-[var(--text-body)]' : 'text-[var(--text-secondary)]'
      )}
    >
      {icon && <span className='flex-shrink-0 text-[var(--text-icon)]'>{icon}</span>}
      <span className='truncate'>{label}</span>
    </span>
  )
})

interface DataRowProps {
  row: ResourceRow
  columns: ResourceColumn[]
  selectedRowId?: string | null
  selectable?: SelectableConfig
  onRowClick?: (rowId: string) => void
  onRowHover?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  hasCheckbox: boolean
}

const DataRow = memo(function DataRow({
  row,
  columns,
  selectedRowId,
  selectable,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  hasCheckbox,
}: DataRowProps) {
  const isSelected = selectable?.selectedIds.has(row.id) ?? false

  const handleClick = useCallback(() => {
    onRowClick?.(row.id)
  }, [onRowClick, row.id])

  const handleMouseEnter = useCallback(() => {
    onRowHover?.(row.id)
  }, [onRowHover, row.id])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onRowContextMenu?.(e, row.id)
    },
    [onRowContextMenu, row.id]
  )

  const handleSelectRow = useCallback(
    (checked: boolean | 'indeterminate') => {
      selectable?.onSelectRow(row.id, checked as boolean)
    },
    [selectable, row.id]
  )

  return (
    <tr
      data-resource-row
      data-row-id={row.id}
      className={cn(
        'transition-colors hover-hover:bg-[var(--surface-3)]',
        onRowClick && 'cursor-pointer',
        (selectedRowId === row.id || isSelected) && 'bg-[var(--surface-3)]'
      )}
      onClick={onRowClick ? handleClick : undefined}
      onMouseEnter={handleMouseEnter}
      onContextMenu={onRowContextMenu ? handleContextMenu : undefined}
    >
      {hasCheckbox && selectable && (
        <td className='w-[52px] py-2.5 pr-0 pl-5 align-middle'>
          <Checkbox
            size='sm'
            checked={isSelected}
            onCheckedChange={handleSelectRow}
            disabled={selectable.disabled}
            aria-label='Select row'
            onClick={stopPropagation}
          />
        </td>
      )}
      {columns.map((col, colIdx) => {
        const cell = row.cells[col.id]
        return (
          <td key={col.id} className='px-6 py-2.5 align-middle'>
            <CellContent
              icon={cell?.icon}
              label={cell?.label || EMPTY_CELL_PLACEHOLDER}
              content={cell?.content}
              primary={colIdx === 0}
            />
          </td>
        )
      })}
    </tr>
  )
})

interface CreateRowProps {
  create: CreateAction
  totalColSpan: number
}

const CreateRow = memo(function CreateRow({ create, totalColSpan }: CreateRowProps) {
  return (
    <tr
      className={cn(
        'transition-colors',
        create.disabled ? 'cursor-not-allowed' : 'cursor-pointer hover-hover:bg-[var(--surface-3)]'
      )}
      onClick={create.disabled ? undefined : create.onClick}
    >
      <td colSpan={totalColSpan} className='px-6 py-2.5 align-middle'>
        <span className='flex items-center gap-3 font-medium text-[var(--text-secondary)] text-sm'>
          {CREATE_ROW_PLUS_ICON}
          {create.label}
        </span>
      </td>
    </tr>
  )
})

interface ResourceColGroupProps {
  columns: ResourceColumn[]
  hasCheckbox?: boolean
}

const ResourceColGroup = memo(function ResourceColGroup({
  columns,
  hasCheckbox,
}: ResourceColGroupProps) {
  return (
    <colgroup>
      {hasCheckbox && <col className='w-[52px]' />}
      {columns.map((col, colIdx) => (
        <col
          key={col.id}
          style={
            colIdx === 0
              ? { minWidth: 200 * (col.widthMultiplier ?? 1) }
              : { width: 160 * (col.widthMultiplier ?? 1) }
          }
        />
      ))}
    </colgroup>
  )
})

interface DataTableSkeletonProps {
  columns: ResourceColumn[]
  rowCount: number
  hasCheckbox?: boolean
}

const DataTableSkeleton = memo(function DataTableSkeleton({
  columns,
  rowCount,
  hasCheckbox,
}: DataTableSkeletonProps) {
  return (
    <>
      <div className='overflow-hidden'>
        <table className='w-full table-fixed text-small'>
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
            <tr>
              {hasCheckbox && (
                <th className='h-10 w-[52px] py-2.5 pr-0 pl-5 text-left align-middle'>
                  <Skeleton className='h-[14px] w-[14px] rounded-xs' />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.id}
                  className='h-10 px-6 py-2.5 text-left align-middle font-base text-[var(--text-muted)]'
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
        <table className='w-full table-fixed text-small'>
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <tbody>
            {Array.from({ length: rowCount }, (_, i) => (
              <tr key={i}>
                {hasCheckbox && (
                  <td className='w-[52px] py-2.5 pr-0 pl-5 align-middle'>
                    <Skeleton className='h-[14px] w-[14px] rounded-xs' />
                  </td>
                )}
                {columns.map((col, colIdx) => (
                  <td key={col.id} className='px-6 py-2.5 align-middle'>
                    <span className='flex min-h-[21px] items-center gap-3'>
                      {colIdx === 0 && <Skeleton className='h-[14px] w-[14px] rounded-xs' />}
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
})
