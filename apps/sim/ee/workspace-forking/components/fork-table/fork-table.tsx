'use client'

import type { ReactNode } from 'react'
import { Checkbox, cn, Skeleton } from '@sim/emcn'
import {
  FORK_TABLE_CARD_CLASS,
  FORK_TABLE_CELL_CLASS,
  FORK_TABLE_CELL_TEXT_CLASS,
  FORK_TABLE_FOCUS_RING_CLASS,
  FORK_TABLE_HEAD_CLASS,
  FORK_TABLE_HEADER_CELL_CLASS,
  FORK_TABLE_ROW_CLASS,
  FORK_TABLE_STATUS_CELL_CLASS,
  FORK_TABLE_SURFACE_CLASS,
  FORK_TREE_INDENT_PER_LEVEL,
  FORK_TREE_RAIL_OFFSET,
} from '@/ee/workspace-forking/components/fork-table/fork-table-chrome'

/** Width of the leading selection column, matching the shared table's. */
const SELECTION_COLUMN_WIDTH = 34

/** Skeleton rows drawn while the first page loads, enough to fill the card without guessing. */
const SKELETON_ROW_COUNT = 4

/** Horizontal alignment of a column's header and cells. */
export type ForkTableAlign = 'left' | 'right'

/** One column of a {@link ForkTable}. */
export interface ForkTableColumn<T> {
  /** Stable identity for the column. */
  key: string
  /** Header label. Omit for columns whose cells speak for themselves. */
  header?: ReactNode
  cell: (row: T) => ReactNode
  /** @default 'left' */
  align?: ForkTableAlign
  /** Fixed width in pixels, applied through the table's `<colgroup>`. */
  width?: number
  /**
   * Pins the column while the card scrolls horizontally. Only meaningful on the leading column —
   * the mappings matrix keeps its resource names visible while the workspace columns scroll.
   */
  sticky?: boolean
}

/**
 * One level of a row's tree connector, root-first:
 *  - `line` — an ancestor whose subtree continues past this row, so its drop line runs full height
 *  - `blank` — an ancestor whose subtree has ended, so the level is empty
 *  - `branch` — this row's own connector, with siblings still to come
 *  - `last-branch` — this row's own connector as the final sibling, so the drop line stops at it
 */
export type ForkTableRail = 'line' | 'blank' | 'branch' | 'last-branch'

/** One level of the tree connector, drawn to bleed through the cell's vertical padding. */
function ForkTreeRail({ rail }: { rail: ForkTableRail }) {
  return (
    <span
      aria-hidden
      className='relative shrink-0 self-stretch'
      style={{ width: `${FORK_TREE_INDENT_PER_LEVEL}px` }}
    >
      {rail === 'blank' ? null : (
        <span
          className='absolute w-px bg-[var(--border)]'
          style={{
            left: `${FORK_TREE_RAIL_OFFSET}px`,
            // The cell's `py-2.5` would otherwise break the line between rows.
            top: '-10px',
            bottom: rail === 'last-branch' ? '50%' : '-10px',
          }}
        />
      )}
      {rail === 'branch' || rail === 'last-branch' ? (
        <span
          className='absolute h-px bg-[var(--border)]'
          style={{
            left: `${FORK_TREE_RAIL_OFFSET}px`,
            top: '50%',
            width: `${FORK_TREE_INDENT_PER_LEVEL - FORK_TREE_RAIL_OFFSET}px`,
          }}
        />
      ) : null}
    </span>
  )
}

/** Controlled multi-select: a checkbox per row and a select-all band carrying the count. */
export interface ForkTableSelection<T> {
  selectedIds: string[]
  onSelectionChange: (selectedIds: string[]) => void
  /** Rendered right-aligned in the select-all band, whenever the band is. */
  bulkActions?: ReactNode
  /**
   * Whether a row may be selected. Rows that fail this render NO checkbox and are excluded from
   * select-all and from every count, so select-all can still reach "all" and toggle back off.
   */
  isRowSelectable?: (row: T) => boolean
}

export interface ForkTableProps<T> {
  rows: T[]
  getRowId: (row: T) => string
  columns: ForkTableColumn<T>[]
  selection?: ForkTableSelection<T>
  /**
   * Tree connectors for a row, root-first. Rows are rendered exactly as given, so the caller
   * flattens its own tree depth-first and describes each row's rails.
   */
  getRowRails?: (row: T) => ForkTableRail[]
  /** Replaces the rows with skeletons — never an empty state, which would read as "nothing here". */
  loading?: boolean
  /** Rendered in place of the rows when there are none. */
  empty?: ReactNode
  'aria-label': string
  /** Layout and sizing only — the table owns its chrome. */
  className?: string
}

/**
 * The Forks console's data table.
 *
 * Chrome is the emcn `Table`'s, literal for literal (see `fork-table-chrome.ts`), but the console
 * needs two behaviours the shared component deliberately does not carry: tree rails on a row, and a
 * pinned leading column for the mappings matrix. Rather than widen a platform primitive for one
 * caller, the console draws its own card from the same tokens.
 *
 * Like the shared table it owns presentation and selection bookkeeping and nothing else — ordering,
 * filtering, and every cell stay with the caller.
 */
export function ForkTable<T>({
  rows,
  getRowId,
  columns,
  selection,
  getRowRails,
  loading = false,
  empty,
  'aria-label': ariaLabel,
  className,
}: ForkTableProps<T>) {
  const rowIds = rows.map(getRowId)
  const selectedIdSet = new Set(selection?.selectedIds ?? [])
  const isRowSelectable = selection?.isRowSelectable
  const selectableIds = isRowSelectable
    ? rowIds.filter((_, index) => isRowSelectable(rows[index]))
    : rowIds
  const selectedCount = selectableIds.reduce(
    (count, id) => (selectedIdSet.has(id) ? count + 1 : count),
    0
  )
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length

  const columnCount = columns.length + (selection ? 1 : 0)
  const hasColumnHeaders = columns.some((column) => column.header !== undefined)

  const toggleAll = () => {
    if (!selection) return
    if (allSelected) {
      const visible = new Set(selectableIds)
      selection.onSelectionChange(selection.selectedIds.filter((id) => !visible.has(id)))
      return
    }
    const next = [...selection.selectedIds]
    for (const id of selectableIds) {
      if (!selectedIdSet.has(id)) next.push(id)
    }
    selection.onSelectionChange(next)
  }

  const toggleRow = (id: string) => {
    if (!selection) return
    selection.onSelectionChange(
      selectedIdSet.has(id)
        ? selection.selectedIds.filter((selectedId) => selectedId !== id)
        : [...selection.selectedIds, id]
    )
  }

  /** A pinned cell needs its own fill, or the scrolled columns show through it. */
  const stickyClass = (column: ForkTableColumn<T>, fill: string) =>
    column.sticky ? cn('sticky left-0 z-[1]', fill) : undefined

  return (
    <div className={cn(FORK_TABLE_CARD_CLASS, className)}>
      <table className='w-full' aria-label={ariaLabel}>
        <colgroup>
          {selection ? <col style={{ width: `${SELECTION_COLUMN_WIDTH}px` }} /> : null}
          {columns.map((column) => (
            <col
              key={column.key}
              style={column.width === undefined ? undefined : { width: `${column.width}px` }}
            />
          ))}
        </colgroup>

        <thead className={FORK_TABLE_HEAD_CLASS}>
          {selection ? (
            <tr className='border-[var(--border)] border-b'>
              <th className={FORK_TABLE_HEADER_CELL_CLASS}>
                <Checkbox
                  size='sm'
                  className={cn(FORK_TABLE_FOCUS_RING_CLASS, FORK_TABLE_SURFACE_CLASS)}
                  aria-label='Select all rows'
                  checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th colSpan={columns.length} className={FORK_TABLE_HEADER_CELL_CLASS}>
                <div className='flex items-center justify-between gap-2'>
                  <span>
                    {selectedCount > 0
                      ? `${selectedCount} selected of ${selectableIds.length}`
                      : `Select all (${selectableIds.length})`}
                  </span>
                  {selection.bulkActions ? (
                    <div className='flex items-center gap-2'>{selection.bulkActions}</div>
                  ) : null}
                </div>
              </th>
            </tr>
          ) : null}
          {hasColumnHeaders ? (
            <tr className='border-[var(--border)] border-b'>
              {selection ? <th scope='col' className={FORK_TABLE_HEADER_CELL_CLASS} /> : null}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope='col'
                  className={cn(
                    FORK_TABLE_HEADER_CELL_CLASS,
                    column.align === 'right' && 'text-right',
                    stickyClass(column, FORK_TABLE_HEAD_CLASS)
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          ) : null}
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <tr key={`skeleton-${index}`} className={FORK_TABLE_ROW_CLASS}>
                <td colSpan={columnCount} className={FORK_TABLE_CELL_CLASS}>
                  <Skeleton className='h-[18px] w-full' />
                </td>
              </tr>
            ))
          ) : rows.length === 0 && empty !== undefined ? (
            <tr>
              <td colSpan={columnCount} className={FORK_TABLE_STATUS_CELL_CLASS}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const id = rowIds[index]
              const rails = getRowRails?.(row)
              const selectable = isRowSelectable ? isRowSelectable(row) : true

              return (
                <tr key={id} className={FORK_TABLE_ROW_CLASS}>
                  {selection ? (
                    <td className={FORK_TABLE_CELL_CLASS}>
                      {selectable ? (
                        <Checkbox
                          size='sm'
                          className={cn(FORK_TABLE_FOCUS_RING_CLASS, FORK_TABLE_SURFACE_CLASS)}
                          aria-label='Select row'
                          checked={selectedIdSet.has(id)}
                          onCheckedChange={() => toggleRow(id)}
                        />
                      ) : null}
                    </td>
                  ) : null}
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.key}
                      className={cn(
                        FORK_TABLE_CELL_CLASS,
                        FORK_TABLE_CELL_TEXT_CLASS,
                        column.align === 'right' && 'text-right',
                        stickyClass(column, FORK_TABLE_SURFACE_CLASS)
                      )}
                    >
                      {rails && columnIndex === 0 ? (
                        <span className='flex min-w-0 items-stretch'>
                          {rails.map((rail, railIndex) => (
                            // Rails are positional by construction — one per ancestor level, in
                            // order — so the index IS their identity.
                            <ForkTreeRail key={railIndex} rail={rail} />
                          ))}
                          <span className='flex min-w-0 flex-1 items-center'>
                            {column.cell(row)}
                          </span>
                        </span>
                      ) : (
                        column.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
