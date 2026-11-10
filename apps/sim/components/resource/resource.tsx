'use client'
import { type CSSProperties, memo, type ReactNode, useCallback, useMemo } from 'react'
import {
  cellIconNodeClass,
  chipActiveSurfaceClass,
  chipContentGap,
  chipContentLabelClass,
  chipHoverSurfaceClass,
  cn,
} from '@sim/emcn-legacy'
import { FloatingOverflowText } from '@/components/resource/components/floating-overflow-text'

export interface ResourceColumn {
  id: string
  header: string
  widthMultiplier?: number
}

interface ResourceCell {
  icon?: ReactNode
  label?: string | null
  content?: ReactNode
}

interface ResourceRow {
  id: string
  cells: Record<string, ResourceCell>
}

const EMPTY_CELL_PLACEHOLDER = '—'

/**
 * Builds the shared CSS grid track list for the header and every body row from
 * the same first-column-weighted ratios the legacy `<colgroup>` used.
 */
function buildGridTemplateColumns(columns: readonly ResourceColumn[]): string {
  return columns
    .map((col, colIdx) => {
      const track = `minmax(0, ${(colIdx === 0 ? 2.5 : 1.0) * (col.widthMultiplier ?? 1)}fr)`
      return colIdx === 0 ? `var(--resource-table-name-width, ${track})` : track
    })
    .join(' ')
}

interface ResourceTableProps {
  columns: readonly ResourceColumn[]
  rows: ResourceRow[]
  selectedRowId?: string | null
  onRowClick?: (rowId: string) => void
  /**
   * Rendered absolutely against the table region (slide-out sidebars). The
   * overlay owns its own chrome and positioning.
   */
  overlay?: ReactNode
  /** Rendered below the column headers when `rows` is empty. */
  emptyState?: ReactNode
}

/**
 * Data table body, exposed only as `Resource.Table`.
 *
 * The table is built from `<div>`s carrying explicit ARIA roles (`table`,
 * `rowgroup`, `row`, `columnheader`, `cell`) rather than native table elements:
 * the rows use CSS grid for column alignment, and `display: grid` on a native
 * `<table>` strips its implicit table semantics, so the roles are declared
 * directly.
 */
const ResourceTable = memo(function ResourceTable({
  columns,
  rows,
  selectedRowId,
  onRowClick,
  overlay,
  emptyState,
}: ResourceTableProps) {
  const showEmptyState = rows.length === 0 && Boolean(emptyState)
  const gridTemplateColumns = useMemo(() => buildGridTemplateColumns(columns), [columns])

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div
        className={cn(
          '@container/resource-table min-h-0 flex-1 overflow-auto overscroll-none',
          showEmptyState && 'flex flex-col'
        )}
      >
        <div
          role='table'
          className='grid w-full min-w-[var(--resource-table-min-width)] text-small md:min-w-0 max-md:[--resource-table-name-width:100cqw]'
          style={
            {
              '--resource-table-min-width': `calc(100cqw + ${Math.max(0, columns.length - 1) * 136}px)`,
            } as CSSProperties
          }
        >
          <div
            role='rowgroup'
            className='sticky top-0 z-10 grid border-[var(--border)] border-b bg-[var(--bg)]'
          >
            <div role='row' className='grid' style={{ gridTemplateColumns }}>
              {columns.map((col) => (
                <div
                  key={col.id}
                  role='columnheader'
                  className='flex h-10 min-w-0 items-center px-3 py-1.5 text-left font-normal text-[var(--text-muted)] text-small max-md:h-11 md:px-6'
                >
                  <span className='min-w-0 truncate'>{col.header}</span>
                </div>
              ))}
            </div>
          </div>
          <div role='rowgroup' className='grid'>
            {rows.map((row) => (
              <DataRow
                key={row.id}
                gridTemplateColumns={gridTemplateColumns}
                row={row}
                columns={columns}
                isSelected={selectedRowId === row.id}
                onRowClick={onRowClick}
              />
            ))}
          </div>
        </div>
        {showEmptyState ? <div className='flex min-h-0 flex-1 flex-col'>{emptyState}</div> : null}
      </div>
      {overlay}
    </div>
  )
})

interface CellContentProps {
  /** Pre-rendered icon node; auto-sized to the chip icon size. */
  icon?: ReactNode
  label: string
  content?: ReactNode
}

const CellContent = memo(function CellContent({ icon, label, content }: CellContentProps) {
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
  columns: readonly ResourceColumn[]
  isSelected: boolean
  onRowClick?: (rowId: string) => void
  /** CSS grid track list shared with the header so columns stay aligned. */
  gridTemplateColumns: string
}

const DataRow = memo(function DataRow({
  row,
  columns,
  isSelected,
  onRowClick,
  gridTemplateColumns,
}: DataRowProps) {
  const handleClick = useCallback(() => {
    onRowClick?.(row.id)
  }, [onRowClick, row.id])

  return (
    <div
      role='row'
      className={cn(
        'grid w-full transition-colors',
        isSelected ? chipActiveSurfaceClass : chipHoverSurfaceClass,
        onRowClick && 'cursor-pointer'
      )}
      style={{ gridTemplateColumns }}
      onClick={onRowClick ? handleClick : undefined}
    >
      {columns.map((col) => {
        const cell = row.cells[col.id]
        return (
          <div
            key={col.id}
            role='cell'
            className='flex min-h-11 min-w-0 items-center gap-1 px-3 pointer-coarse:py-0 py-0 md:min-h-0 md:px-6 md:py-2.5'
          >
            <CellContent
              icon={cell?.icon}
              label={cell?.label || EMPTY_CELL_PLACEHOLDER}
              content={cell?.content}
            />
          </div>
        )
      })}
    </div>
  )
})

/** Compound namespace for the resource table. */
export const Resource = {
  Table: ResourceTable,
}
