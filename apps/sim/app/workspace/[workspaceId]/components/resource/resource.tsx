'use client'
import {
  type CSSProperties,
  type DragEvent,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  onDragStart?: (e: DragEvent<HTMLDivElement>, rowId: string) => void
  onDragOver?: (e: DragEvent<HTMLDivElement>, rowId: string) => void
  onDragLeave?: (e: DragEvent<HTMLDivElement>, rowId: string) => void
  onDrop?: (e: DragEvent<HTMLDivElement>, rowId: string) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>, rowId: string) => void
}

export interface PaginationConfig {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export const EMPTY_CELL_PLACEHOLDER = '—'

/**
 * Seed height (px) for each virtualized row before it is measured. Every
 * consumer renders single-line `py-2.5` cells, so this matches the resting row
 * height closely; `measureElement` then corrects each row to its exact pixel
 * height after mount, so the estimate only affects pre-measure scroll math.
 */
const ROW_HEIGHT_ESTIMATE = 41 as const

/** Rows rendered above/below the viewport to avoid blank flashes on fast scroll. */
const ROW_OVERSCAN = 8 as const

const CHECKBOX_COLUMN_WIDTH = '52px'

/**
 * Builds the shared CSS grid track list for the header and every body row from
 * the same first-column-weighted ratios the legacy `<colgroup>` used, so the
 * virtualized grid layout reproduces the exact column widths. The checkbox
 * column, when present, is a fixed leading track.
 */
function buildGridTemplateColumns(columns: ResourceColumn[], hasCheckbox: boolean): string {
  const weights = columns.map(
    (col, colIdx) => (colIdx === 0 ? 2.5 : 1.0) * (col.widthMultiplier ?? 1)
  )
  const total = weights.reduce((s, w) => s + w, 0)
  const tracks = columns.map((_, colIdx) => `minmax(0, ${(weights[colIdx] / total).toFixed(6)}fr)`)
  return hasCheckbox ? `${CHECKBOX_COLUMN_WIDTH} ${tracks.join(' ')}` : tracks.join(' ')
}

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

/**
 * Imperative handle for `Resource.Table`. Lets a consumer drive virtualizer-aware
 * scrolling — required for keyboard navigation, since a `querySelector` on the
 * selected row's DOM node silently no-ops once that row is windowed out.
 */
export interface ResourceTableHandle {
  /** Scroll the row with the given id into view via the virtualizer (works even when the row is not in the DOM). */
  scrollToRow: (rowId: string) => void
}

interface ResourceTableProps {
  columns: ResourceColumn[]
  rows: ResourceRow[]
  selectedRowId?: string | null
  /** Optional imperative handle exposing {@link ResourceTableHandle} (e.g. for keyboard-nav scrolling). */
  apiRef?: RefObject<ResourceTableHandle | null>
  /**
   * Window the row list with `@tanstack/react-virtual`, keeping only the visible
   * slice in the DOM. Opt-in because it removes off-screen rows — consumers that
   * depend on every row being mounted (e.g. drag-and-drop drop targets) must stay
   * on the full-DOM path. Enable it only for unbounded, accumulating lists (logs).
   */
  virtualized?: boolean
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
 * Chrome guarantee: the table region and column headers render unconditionally —
 * no prop or row state (empty, loading, error) ever drops them. Structural
 * additions (checkbox column, load-more sentinel, pagination bar) are driven
 * purely by which configs the consumer supplies and always render the canonical
 * chrome.
 *
 * The table is built from `<div>`s carrying explicit ARIA roles (`table`,
 * `rowgroup`, `row`, `columnheader`, `cell`) rather than native table elements:
 * the rows use CSS grid for column alignment, and `display: grid` on a native
 * `<table>` strips its implicit table semantics, so the roles are declared
 * directly. Column widths come from a shared grid track list (see
 * {@link buildGridTemplateColumns}) reproducing the legacy `<colgroup>` ratios.
 * When `virtualized`, the body windows with `@tanstack/react-virtual` so only
 * the visible row slice is in the DOM, bounding DOM size and memory on lists
 * that accumulate many pages.
 */
const ResourceTable = memo(function ResourceTable({
  columns,
  rows,
  selectedRowId,
  apiRef,
  virtualized = false,
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
  const t = useTranslations('auto')
  const scrollRef = useRef<HTMLDivElement>(null)
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

  const gridTemplateColumns = useMemo(
    () => buildGridTemplateColumns(columns, hasCheckbox),
    [columns, hasCheckbox]
  )

  /**
   * Windows the row list so only the visible slice (plus overscan) is in the
   * DOM, bounding DOM size and memory regardless of how many pages a consumer
   * accumulates. Rows are measured via {@link rowVirtualizer.measureElement} so
   * any single-line height variance stays pixel-exact.
   */
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: ROW_OVERSCAN,
    getItemKey: (index) => rows[index].id,
  })

  useImperativeHandle(
    apiRef,
    () => ({
      scrollToRow: (rowId: string) => {
        const index = rows.findIndex((row) => row.id === rowId)
        if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: 'auto' })
      },
    }),
    [rows, rowVirtualizer]
  )

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div ref={scrollRef} className='min-h-0 flex-1 overflow-auto overscroll-none'>
        <div role='table' className='grid w-full text-small'>
          <div
            role='rowgroup'
            className='sticky top-0 z-10 grid bg-[var(--bg)] shadow-[inset_0_-1px_0_var(--border)]'
          >
            <div role='row' className='grid' style={{ gridTemplateColumns }}>
              {hasCheckbox && (
                <div
                  role='columnheader'
                  className='flex h-10 items-center py-1.5 pr-0 pl-5 text-left'
                >
                  <Checkbox
                    size='sm'
                    checked={selectable.isAllSelected}
                    onCheckedChange={handleSelectAll}
                    disabled={selectable.disabled}
                    aria-label={t('select_all')}
                  />
                </div>
              )}
              {columns.map((col) => (
                <div
                  key={col.id}
                  role='columnheader'
                  className='flex h-10 min-w-0 items-center px-6 py-1.5 text-left font-normal text-[var(--text-muted)] text-small'
                >
                  <span className='min-w-0 truncate'>{col.header}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            role='rowgroup'
            className={cn('grid', virtualized && 'relative')}
            style={virtualized ? { height: totalSize } : undefined}
          >
            {virtualized
              ? virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  return (
                    <DataRow
                      key={virtualRow.key}
                      ref={rowVirtualizer.measureElement}
                      dataIndex={virtualRow.index}
                      translateY={virtualRow.start}
                      gridTemplateColumns={gridTemplateColumns}
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
                  )
                })
              : rows.map((row) => (
                  <DataRow
                    key={row.id}
                    gridTemplateColumns={gridTemplateColumns}
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
          </div>
        </div>
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
  /** CSS grid track list shared with the header so columns stay aligned. */
  gridTemplateColumns: string
  /**
   * Virtual row offset. When set, the row is absolutely positioned within the
   * sized tbody (windowed mode); when omitted, the row renders in normal grid
   * flow (full-DOM mode).
   */
  translateY?: number
  /** Virtual index, consumed by the virtualizer's `measureElement` ref (windowed mode only). */
  dataIndex?: number
  /** Forwarded from the virtualizer so each mounted row is measured exactly (windowed mode only). */
  ref?: (node: HTMLDivElement | null) => void
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
  gridTemplateColumns,
  translateY,
  dataIndex,
  ref,
}: DataRowProps) {
  const t = useTranslations('auto')
  const isSelected = selectable?.selectedIds.has(row.id) ?? false
  const isDraggable = rowDragDrop?.isRowDraggable?.(row.id) ?? false
  const isDropTarget = rowDragDrop?.isRowDropTarget?.(row.id) ?? false
  const isActiveDropTarget = rowDragDrop?.activeDropTargetId === row.id
  const isDragging = rowDragDrop?.draggedRowIds?.has(row.id) ?? false
  const isAnyDragActive = rowDragDrop?.isAnyDragActive ?? false
  const hasActiveSelection = (selectable?.selectedIds.size ?? 0) > 0

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    rowDragDrop?.onDragStart?.(e, row.id)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    rowDragDrop?.onDragOver?.(e, row.id)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    rowDragDrop?.onDragLeave?.(e, row.id)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    rowDragDrop?.onDrop?.(e, row.id)
  }

  const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
    rowDragDrop?.onDragEnd?.(e, row.id)
  }

  const isWindowed = translateY !== undefined
  const rowStyle: CSSProperties = isWindowed
    ? { gridTemplateColumns, transform: `translateY(${translateY}px)` }
    : { gridTemplateColumns }

  return (
    <div
      ref={ref}
      role='row'
      data-index={dataIndex}
      data-resource-row
      data-row-id={row.id}
      className={cn(
        'grid w-full transition-colors',
        isWindowed && 'absolute top-0 left-0',
        !isAnyDragActive && 'hover-hover:bg-[var(--surface-3)]',
        onRowClick && 'cursor-pointer',
        isDraggable && 'cursor-grab active:cursor-grabbing',
        isDropTarget && 'data-[drop-target=true]:outline-offset-[-1px]',
        (selectedRowId === row.id || isSelected || isContextMenuTarget) && 'bg-[var(--surface-3)]',
        isActiveDropTarget && 'bg-[var(--surface-4)] outline outline-1 outline-[var(--accent)]',
        (isDragging || (isAnyDragActive && isSelected && !isActiveDropTarget)) && 'opacity-50'
      )}
      style={rowStyle}
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
        <div role='cell' className='flex items-center py-2.5 pr-0 pl-5'>
          <Checkbox
            size='sm'
            checked={isSelected}
            onCheckedChange={handleSelectRow}
            disabled={selectable.disabled}
            aria-label={t('select_row')}
            onClick={handleSelectRowClick}
          />
        </div>
      )}
      {columns.map((col) => {
        const cell = row.cells[col.id]
        return (
          <div key={col.id} role='cell' className='flex min-w-0 items-center px-6 py-2.5'>
            <CellContent
              icon={cell?.icon}
              label={cell?.label || EMPTY_CELL_PLACEHOLDER}
              content={cell?.content}
              editing={cell?.editing}
            />
          </div>
        )
      })}
    </div>
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
