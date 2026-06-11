'use client'
import {
  type DragEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Button,
  Checkbox,
  cellIconNodeClass,
  chipContentGap,
  chipContentLabelClass,
  Loader,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { InlineRenameInput } from '@/app/workspace/[workspaceId]/components/inline-rename-input'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components/resource/components/floating-overflow-text'
import { ResourceHeader } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import { ResourceOptions } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'

export interface ResourceColumn {
  id: string
  header: string
  widthMultiplier?: number
}

export interface ResourceCellEditing {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  /**
   * Disables the rename field while the save is in flight, mirroring the
   * sidebar's `disabled={isRenaming}`. Threaded from `useInlineRename`'s
   * `isSaving`. Optional so existing consumers keep working unchanged.
   */
  disabled?: boolean
}

export interface ResourceCell {
  icon?: ReactNode
  label?: string | null
  content?: ReactNode
  /**
   * When set, the cell renders an inline rename field inside the canonical cell
   * chrome (icon + {@link InlineRenameInput}). Consumers pass structured handlers
   * instead of hand-rolling a `content` node, so every rename cell matches the
   * resting cell exactly (same gap, weight, icon size).
   */
  editing?: ResourceCellEditing
}

export interface ResourceRow {
  id: string
  cells: Record<string, ResourceCell>
}

export interface SelectableConfig {
  selectedIds: Set<string>
  onSelectRow: (id: string, checked: boolean, shiftKey?: boolean) => void
  onSelectAll: (checked: boolean) => void
  isAllSelected: boolean
  disabled?: boolean
}

export interface RowDragDropConfig {
  activeDropTargetId?: string | null
  draggedRowIds?: Set<string>
  isAnyDragActive?: boolean
  isRowDraggable?: (rowId: string) => boolean
  isRowDropTarget?: (rowId: string) => boolean
  onDragStart?: (e: DragEvent<HTMLTableRowElement>, rowId: string) => void
  onDragOver?: (e: DragEvent<HTMLTableRowElement>, rowId: string) => void
  onDragLeave?: (e: DragEvent<HTMLTableRowElement>, rowId: string) => void
  onDrop?: (e: DragEvent<HTMLTableRowElement>, rowId: string) => void
  onDragEnd?: (e: DragEvent<HTMLTableRowElement>, rowId: string) => void
}

export interface PaginationConfig {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export const EMPTY_CELL_PLACEHOLDER = '—'

interface ResourceProps {
  children: ReactNode
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * Compound page shell for resource pages (tables, files, knowledge, schedules,
 * logs, and the detail editors). Consumers import only `Resource` and fill the
 * defined slots as children:
 *
 * - `Resource.Header` — required, the top bar (title/breadcrumbs + action chips)
 * - `Resource.Options` — required, the search/filter/sort toolbar
 * - `Resource.Table` — optional; swap for any custom body (dashboard, grid, …)
 *
 * Invariant: the shell renders identically for every consumer. Consumers supply
 * content (columns, rows, cells) and behavior (handlers, configs) only — no
 * prop changes the shell's chrome, spacing, or structure. The only sanctioned
 * variation is replacing `Resource.Table` with a custom body.
 *
 * The shell owns the fixed column layout and is the positioning context for
 * absolutely-positioned overlays (action bars, slide-out sidebars); the
 * children own their own chrome.
 */
function ResourceRoot({ children, onContextMenu }: ResourceProps) {
  return (
    <div
      className='relative flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  )
}

interface ResourceTableProps {
  columns: ResourceColumn[]
  rows: ResourceRow[]
  selectedRowId?: string | null
  selectable?: SelectableConfig
  rowDragDrop?: RowDragDropConfig
  onRowClick?: (rowId: string) => void
  onRowHover?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
  pagination?: PaginationConfig
  /**
   * Sanctioned overlay slot. Rendered absolutely against the table region
   * (action bars, slide-out sidebars, drop targets). The overlay owns its own
   * chrome and positioning; it never alters the table's rendering.
   */
  overlay?: ReactNode
}

/**
 * Data table body, module-private and exposed only as `Resource.Table` — the
 * compound member is the sole way consumers render it.
 *
 * Chrome guarantee: the `<table>`, `<colgroup>`, and column headers render
 * unconditionally — no prop or row state (empty, loading, error) ever drops
 * them. Structural additions (checkbox column, load-more sentinel, pagination
 * bar) are driven purely by which configs the consumer supplies and always
 * render the canonical chrome.
 */
const ResourceTable = memo(function ResourceTable({
  columns,
  rows,
  selectedRowId,
  selectable,
  rowDragDrop,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  onLoadMore,
  hasMore,
  isLoadingMore,
  pagination,
  overlay,
}: ResourceTableProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const [contextMenuRowId, setContextMenuRowId] = useState<string | null>(null)

  const wrappedOnRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      setContextMenuRowId(rowId)
      onRowContextMenu?.(e, rowId)
    },
    [onRowContextMenu]
  )

  useEffect(() => {
    if (!contextMenuRowId) return
    const clear = () => setContextMenuRowId(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', handleKeyDown)
        clear()
      }
    }
    const timeoutId = setTimeout(() => {
      document.addEventListener('pointerdown', clear, { once: true })
      document.addEventListener('keydown', handleKeyDown)
    }, 0)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('pointerdown', clear)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenuRowId])

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

  const handleSelectAll = useCallback(
    (checked: boolean | 'indeterminate') => {
      selectable?.onSelectAll(checked as boolean)
    },
    [selectable]
  )

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='min-h-0 flex-1 overflow-auto overscroll-none'>
        <table className='w-full table-fixed text-small'>
          <ResourceColGroup columns={columns} hasCheckbox={hasCheckbox} />
          <thead className='sticky top-0 z-10 bg-[var(--bg)] shadow-[inset_0_-1px_0_var(--border)]'>
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
              {columns.map((col) => (
                <th
                  key={col.id}
                  className='h-10 px-6 py-1.5 text-left align-middle font-normal text-[var(--text-muted)] text-small'
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DataRow
                key={row.id}
                row={row}
                columns={columns}
                selectedRowId={selectedRowId}
                selectable={selectable}
                rowDragDrop={rowDragDrop}
                onRowClick={onRowClick}
                onRowHover={onRowHover}
                onRowContextMenu={onRowContextMenu ? wrappedOnRowContextMenu : undefined}
                isContextMenuTarget={contextMenuRowId === row.id}
                hasCheckbox={hasCheckbox}
              />
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div ref={loadMoreRef} className='flex items-center justify-center py-3'>
            {isLoadingMore && (
              <Loader className='size-[16px] text-[var(--text-secondary)]' animate />
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
          <ChevronLeft className='size-3.5' />
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
              <Button
                key={page}
                type='button'
                variant='ghost'
                onClick={() => onPageChange(page)}
                className={cn(
                  'h-auto p-0 font-medium text-sm transition-colors hover-hover:bg-transparent hover-hover:text-[var(--text-body)]',
                  page === currentPage ? 'text-[var(--text-body)]' : 'text-[var(--text-secondary)]'
                )}
              >
                {page}
              </Button>
            )
          })}
        </div>
        <Button
          variant='ghost'
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          <ChevronRight className='size-3.5' />
        </Button>
      </div>
    </div>
  )
})

interface CellContentProps {
  /** Pre-rendered icon node (svg/img/span avatar); auto-sized to the chip icon size. */
  icon?: ReactNode
  label: string
  content?: ReactNode
  editing?: ResourceCellEditing
}

const CellContent = memo(function CellContent({ icon, label, content, editing }: CellContentProps) {
  if (editing) {
    return (
      <span className={cn('flex min-w-0 items-center', chipContentGap)}>
        {icon && <span className={cellIconNodeClass}>{icon}</span>}
        <InlineRenameInput
          value={editing.value}
          onChange={editing.onChange}
          onSubmit={editing.onSubmit}
          onCancel={editing.onCancel}
          disabled={editing.disabled}
        />
      </span>
    )
  }
  if (content) return <>{content}</>
  return (
    <span className={cn('flex min-w-0 items-center', chipContentGap)}>
      {icon && <span className={cellIconNodeClass}>{icon}</span>}
      <FloatingOverflowText label={label} className={cn('block', chipContentLabelClass)} />
    </span>
  )
})

interface DataRowProps {
  row: ResourceRow
  columns: ResourceColumn[]
  selectedRowId?: string | null
  selectable?: SelectableConfig
  rowDragDrop?: RowDragDropConfig
  onRowClick?: (rowId: string) => void
  onRowHover?: (rowId: string) => void
  onRowContextMenu?: (e: React.MouseEvent, rowId: string) => void
  isContextMenuTarget?: boolean
  hasCheckbox: boolean
}

const DataRow = memo(function DataRow({
  row,
  columns,
  selectedRowId,
  selectable,
  rowDragDrop,
  onRowClick,
  onRowHover,
  onRowContextMenu,
  isContextMenuTarget,
  hasCheckbox,
}: DataRowProps) {
  const isSelected = selectable?.selectedIds.has(row.id) ?? false
  const isDraggable = rowDragDrop?.isRowDraggable?.(row.id) ?? false
  const isDropTarget = rowDragDrop?.isRowDropTarget?.(row.id) ?? false
  const isActiveDropTarget = rowDragDrop?.activeDropTargetId === row.id
  const isDragging = rowDragDrop?.draggedRowIds?.has(row.id) ?? false
  const isAnyDragActive = rowDragDrop?.isAnyDragActive ?? false
  const hasActiveSelection = (selectable?.selectedIds.size ?? 0) > 0

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>) => {
      if (
        selectable &&
        !selectable.disabled &&
        (e.shiftKey || e.metaKey || e.ctrlKey || !onRowClick || hasActiveSelection)
      ) {
        e.preventDefault()
        selectable.onSelectRow(row.id, !isSelected, e.shiftKey)
        return
      }
      onRowClick?.(row.id)
    },
    [hasActiveSelection, isSelected, onRowClick, row.id, selectable]
  )

  const handleMouseEnter = useCallback(() => {
    onRowHover?.(row.id)
  }, [onRowHover, row.id])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      onRowContextMenu?.(e, row.id)
    },
    [onRowContextMenu, row.id]
  )

  const shiftKeyRef = useRef(false)

  const handleSelectRowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    shiftKeyRef.current = e.shiftKey
  }, [])

  const handleSelectRow = useCallback(
    (checked: boolean | 'indeterminate') => {
      selectable?.onSelectRow(row.id, checked as boolean, shiftKeyRef.current)
      shiftKeyRef.current = false
    },
    [selectable, row.id]
  )

  const handleDragStart = (e: DragEvent<HTMLTableRowElement>) => {
    rowDragDrop?.onDragStart?.(e, row.id)
  }

  const handleDragOver = (e: DragEvent<HTMLTableRowElement>) => {
    rowDragDrop?.onDragOver?.(e, row.id)
  }

  const handleDragLeave = (e: DragEvent<HTMLTableRowElement>) => {
    rowDragDrop?.onDragLeave?.(e, row.id)
  }

  const handleDrop = (e: DragEvent<HTMLTableRowElement>) => {
    rowDragDrop?.onDrop?.(e, row.id)
  }

  const handleDragEnd = (e: DragEvent<HTMLTableRowElement>) => {
    rowDragDrop?.onDragEnd?.(e, row.id)
  }

  return (
    <tr
      data-resource-row
      data-row-id={row.id}
      className={cn(
        'transition-colors',
        !isAnyDragActive && 'hover-hover:bg-[var(--surface-3)]',
        onRowClick && 'cursor-pointer',
        isDraggable && 'cursor-grab active:cursor-grabbing',
        isDropTarget && 'data-[drop-target=true]:outline-offset-[-1px]',
        (selectedRowId === row.id || isSelected || isContextMenuTarget) && 'bg-[var(--surface-3)]',
        isActiveDropTarget && 'bg-[var(--surface-4)] outline outline-1 outline-[var(--accent)]',
        (isDragging || (isAnyDragActive && isSelected && !isActiveDropTarget)) && 'opacity-50'
      )}
      data-drop-target={isDropTarget || undefined}
      draggable={isDraggable}
      onClick={onRowClick || selectable ? handleClick : undefined}
      onMouseEnter={handleMouseEnter}
      onContextMenu={onRowContextMenu ? handleContextMenu : undefined}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragOver={isDropTarget ? handleDragOver : undefined}
      onDragLeave={isDropTarget ? handleDragLeave : undefined}
      onDrop={isDropTarget ? handleDrop : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
    >
      {hasCheckbox && selectable && (
        <td className='w-[52px] py-2.5 pr-0 pl-5 align-middle'>
          <Checkbox
            size='sm'
            checked={isSelected}
            onCheckedChange={handleSelectRow}
            disabled={selectable.disabled}
            aria-label='Select row'
            onClick={handleSelectRowClick}
          />
        </td>
      )}
      {columns.map((col) => {
        const cell = row.cells[col.id]
        return (
          <td key={col.id} className='px-6 py-2.5 align-middle'>
            <CellContent
              icon={cell?.icon}
              label={cell?.label || EMPTY_CELL_PLACEHOLDER}
              content={cell?.content}
              editing={cell?.editing}
            />
          </td>
        )
      })}
    </tr>
  )
})

interface ResourceColGroupProps {
  columns: ResourceColumn[]
  hasCheckbox?: boolean
}

const CHECKBOX_COLUMN_WIDTH = '52px'

const ResourceColGroup = memo(function ResourceColGroup({
  columns,
  hasCheckbox,
}: ResourceColGroupProps) {
  const weights = columns.map(
    (col, colIdx) => (colIdx === 0 ? 2.5 : 1.0) * (col.widthMultiplier ?? 1)
  )
  const total = weights.reduce((s, w) => s + w, 0)
  return (
    <colgroup>
      {hasCheckbox && <col style={{ width: CHECKBOX_COLUMN_WIDTH }} />}
      {columns.map((col, colIdx) => (
        <col key={col.id} style={{ width: `${((weights[colIdx] / total) * 100).toFixed(3)}%` }} />
      ))}
    </colgroup>
  )
})

/**
 * The single public entry point. `Resource` is the layout shell; its compound
 * members are the only building blocks consumers compose. Import `Resource` and
 * nothing else from this module.
 */
export const Resource = Object.assign(ResourceRoot, {
  Header: ResourceHeader,
  Options: ResourceOptions,
  Table: ResourceTable,
})
