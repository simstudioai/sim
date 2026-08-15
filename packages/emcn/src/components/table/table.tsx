'use client'

import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useMemo, useRef } from 'react'
import { Search } from '../../icons'
import { cn } from '../../lib/cn'
import { Checkbox } from '../checkbox/checkbox'
import {
  chipActiveSurfaceClass,
  chipFilledFillTokens,
  chipHoverSurfaceClass,
} from '../chip/chip-chrome'
import { ChipInput } from '../chip-input/chip-input'

/**
 * The package's focus affordance for controls that suppress the native outline
 * — a soft halo in the same tokens `Switch` and `Slider` use, drawn flush
 * against the control (no ring offset) so it reads the same on the table's
 * tinted header band as it does on a row.
 */
const FOCUS_RING_CLASS =
  'focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)]'
/**
 * The card the table paints on. The checkboxes pin their fill to it too: an
 * unchecked `Checkbox` is `bg-transparent`, so it takes the colour of whatever
 * sits behind it — the tinted header band for select-all, the card for every
 * row — which read as two different controls down one column. The
 * checked/indeterminate fills still win, being state-modified.
 */
const SURFACE_CLASS = 'bg-[var(--surface-2)]'
/** Row cells: an 8px inner rhythm with a 12px gutter at both edges of the card. */
const CELL_CLASS = 'px-2 py-2.5 align-middle first:pl-3 last:pr-3'
/** Header cells, muted and normal-weight — the UA bolds and centers `<th>`. */
const HEADER_CELL_CLASS =
  'px-2 py-2 text-left align-middle font-normal text-[var(--text-muted)] text-caption first:pl-3 last:pr-3'

/** Horizontal alignment of a column's header and cells. */
export type TableColumnAlign = 'left' | 'right'

/** One column of a {@link Table}. */
export interface TableColumn<T> {
  /** Stable identity for the column. */
  key: string
  /** Header label. Omit for columns whose cells speak for themselves (an action button, a row menu). */
  header?: ReactNode
  /** Renders one row's cell. */
  cell: (row: T) => ReactNode
  /**
   * Alignment of the header and every cell in this column.
   * @default 'left'
   */
  align?: TableColumnAlign
  /**
   * Fixed column width in pixels, applied through the table's `<colgroup>`.
   * Columns without one share the remaining width. A caller-supplied length is
   * the one value that cannot be a class, so it is set as a style on `<col>`.
   */
  width?: number
}

/** One tab above a {@link Table}. */
export interface TableTab {
  id: string
  label: ReactNode
}

/** Tab strip above the toolbar. The caller owns what each tab selects. */
export interface TableTabs {
  items: TableTab[]
  activeId: string
  onChange: (id: string) => void
}

/** The toolbar's controlled search field. */
export interface TableToolbarSearch {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/** The row above the table card. */
export interface TableToolbar {
  search: TableToolbarSearch
  /**
   * Right-aligned filter controls — pass `ChipDropdown`/`ChipSelect` elements.
   * The table renders them and never interprets them: filtering and sorting
   * stay entirely with the caller.
   */
  filters?: ReactNode
}

/**
 * Controlled multi-select: a checkbox per row and a select-all band carrying the
 * count and any bulk actions.
 */
export interface TableMultiSelection<T> {
  mode?: 'multiple'
  selectedIds: string[]
  onSelectionChange: (selectedIds: string[]) => void
  /**
   * Rendered right-aligned in the select-all band. Rendered whenever the band
   * is — NOT only while something is selected — so a persistent control can sit
   * there and disable itself against an empty selection, rather than appearing
   * and disappearing as rows are ticked.
   */
  bulkActions?: ReactNode
  /**
   * Whether a row may be selected. Rows that fail this render NO checkbox and
   * are excluded from select-all and from every count, so select-all can still
   * reach "all" and toggle back off.
   *
   * An empty cell rather than a disabled checkbox: a disabled one is a faint
   * outline that still reads as "unchecked", so a list where several rows
   * cannot be picked looks like select-all is broken — the count says "4 of 4"
   * while eight boxes sit on screen. Nothing at all is unambiguous, and the row
   * explains WHY in its own cells.
   *
   * Filtering unselectable ids out in `onSelectionChange` instead is worse
   * still: the checkbox looks interactive and silently does nothing.
   */
  isRowSelectable?: (row: T) => boolean
}

/**
 * Controlled single-select: the row itself is the control, so there is no
 * checkbox column and no select-all band. Picking one row replaces the choice.
 */
export interface TableSingleSelection<T> {
  mode: 'single'
  selectedId: string | null
  onSelect: (id: string) => void
  /** Whether a row may be picked. Unselectable rows are inert and not focusable. */
  isRowSelectable?: (row: T) => boolean
}

/** Controlled row selection, in either mode. */
export type TableSelection<T> = TableMultiSelection<T> | TableSingleSelection<T>

/** Index a tab-strip key moves to, or `null` when the key does not drive the strip. */
function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The tab strip above the toolbar.
 *
 * `role='tablist'` promises assistive tech two things: the strip is ONE tab
 * stop, and the arrow keys move within it. Both are honoured here — a roving
 * `tabIndex` and Left/Right/Home/End — selecting as focus lands, the
 * automatic-activation pattern the ARIA practices recommend when switching is
 * cheap, as it is for rows already in memory.
 */
function TableTabStrip({ items, activeId, onChange }: TableTabs) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = items.findIndex((tab) => tab.id === activeId)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = nextTabIndex(event.key, activeIndex, items.length)
    if (target === null) return
    event.preventDefault()
    onChange(items[target].id)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
  }

  return (
    <div
      ref={listRef}
      role='tablist'
      onKeyDown={handleKeyDown}
      className='flex items-center gap-4 border-[var(--border)] border-b'
    >
      {items.map((tab, index) => {
        const isActive = index === activeIndex
        return (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={isActive}
            /*
             * When `activeId` names no tab, the first one holds the strip's
             * single tab stop — otherwise the strip would have none at all and
             * the keyboard could never reach it.
             */
            tabIndex={(activeIndex === -1 ? index === 0 : isActive) ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 pb-2 text-small transition-colors',
              FOCUS_RING_CLASS,
              isActive
                ? 'border-[var(--text-body)] text-[var(--text-body)]'
                : 'border-transparent text-[var(--text-muted)] hover-hover:text-[var(--text-body)]'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/** Props for {@link Table}. */
export interface TableProps<T> {
  rows: T[]
  getRowId: (row: T) => string
  columns: TableColumn<T>[]
  tabs?: TableTabs
  toolbar?: TableToolbar
  selection?: TableSelection<T>
  /** Rendered in place of the rows when there are none. */
  empty?: ReactNode
  /** Accessible name for the table. */
  'aria-label'?: string
  /** Layout and sizing only — the table owns its chrome. */
  className?: string
}

/**
 * The platform's data table: optional tabs, an optional search-and-filter
 * toolbar, and a bordered card whose header row carries select-all and bulk
 * actions.
 *
 * It owns presentation and selection bookkeeping and nothing else. Sorting,
 * filtering, and paging belong to the caller — `rows` is rendered exactly as
 * given, and the toolbar's `filters` is a slot, not a filter language. Cells
 * are caller-rendered too, so a role, a button, and a row menu are three
 * ordinary columns.
 *
 * @example
 * ```tsx
 * <Table
 *   aria-label='Team members'
 *   rows={members}
 *   getRowId={(member) => member.id}
 *   tabs={{ items: TABS, activeId: tab, onChange: setTab }}
 *   toolbar={{
 *     search: { value: query, onChange: setQuery, placeholder: 'Search members' },
 *     filters: (
 *       <ChipDropdown value={role} options={ROLE_OPTIONS} onChange={setRole} placeholder='All Team Roles' />
 *     ),
 *   }}
 *   selection={{
 *     selectedIds,
 *     onSelectionChange: setSelectedIds,
 *     bulkActions: <Chip onClick={removeSelected}>Remove</Chip>,
 *   }}
 *   columns={[
 *     {
 *       key: 'member',
 *       cell: (member) => (
 *         <TableIdentityCell primary={member.name} secondary={member.email} imageSrc={member.image} />
 *       ),
 *     },
 *     { key: 'role', align: 'right', cell: (member) => member.role },
 *     {
 *       key: 'access',
 *       align: 'right',
 *       width: 160,
 *       cell: (member) => <Chip variant='border' onClick={() => manage(member)}>Manage access</Chip>,
 *     },
 *     {
 *       key: 'menu',
 *       align: 'right',
 *       width: 48,
 *       cell: (member) => (
 *         <DropdownMenu>
 *           <DropdownMenuTrigger asChild>
 *             <Chip aria-label='More actions' leftIcon={MoreHorizontal} />
 *           </DropdownMenuTrigger>
 *           <DropdownMenuContent align='end'>
 *             <DropdownMenuItem onSelect={() => remove(member)}>Remove</DropdownMenuItem>
 *           </DropdownMenuContent>
 *         </DropdownMenu>
 *       ),
 *     },
 *   ]}
 *   empty={<span>No members yet</span>}
 * />
 * ```
 */
export function Table<T>({
  rows,
  getRowId,
  columns,
  tabs,
  toolbar,
  selection,
  empty,
  'aria-label': ariaLabel,
  className,
}: TableProps<T>) {
  const multiSelection = selection && selection.mode !== 'single' ? selection : undefined
  const singleSelection = selection && selection.mode === 'single' ? selection : undefined
  const selectedIdSet = useMemo(
    () => new Set(multiSelection?.selectedIds ?? []),
    [multiSelection?.selectedIds]
  )
  const rowIds = rows.map(getRowId)
  /**
   * Every count and the select-all toggle read the SELECTABLE rows, not all
   * rows. Counting unselectable rows would strand select-all permanently
   * indeterminate, with no way to clear the selection from the header.
   */
  const isRowSelectable = selection?.isRowSelectable
  const selectableIds = isRowSelectable
    ? rowIds.filter((_, index) => isRowSelectable(rows[index]))
    : rowIds
  const selectableCount = selectableIds.length
  const selectedCount = selectableIds.reduce(
    (count, id) => (selectedIdSet.has(id) ? count + 1 : count),
    0
  )
  const allSelected = selectableCount > 0 && selectedCount === selectableCount
  /** Only multi-select adds a leading control column; single-select uses the row itself. */
  const columnCount = columns.length + (multiSelection ? 1 : 0)
  const hasColumnHeaders = columns.some((column) => column.header !== undefined)

  const toggleAll = () => {
    if (!multiSelection) return
    if (allSelected) {
      const visibleIds = new Set(selectableIds)
      multiSelection.onSelectionChange(
        multiSelection.selectedIds.filter((id) => !visibleIds.has(id))
      )
      return
    }
    const next = [...multiSelection.selectedIds]
    for (const id of selectableIds) {
      if (!selectedIdSet.has(id)) next.push(id)
    }
    multiSelection.onSelectionChange(next)
  }

  const toggleRow = (id: string) => {
    if (!multiSelection) return
    multiSelection.onSelectionChange(
      selectedIdSet.has(id)
        ? multiSelection.selectedIds.filter((selectedId) => selectedId !== id)
        : [...multiSelection.selectedIds, id]
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {tabs ? <TableTabStrip {...tabs} /> : null}

      {toolbar ? (
        <div className='flex items-center gap-2'>
          <ChipInput
            icon={Search}
            className='min-w-0 flex-1'
            value={toolbar.search.value}
            placeholder={toolbar.search.placeholder}
            aria-label={toolbar.search.placeholder ?? 'Search'}
            onChange={(event) => toolbar.search.onChange(event.target.value)}
          />
          {toolbar.filters ? (
            <div className='flex shrink-0 items-center gap-2'>{toolbar.filters}</div>
          ) : null}
        </div>
      ) : null}

      {/*
        `min-h-0` so the card can shrink inside a height-capped `className`
        (a table in a modal): a flex item defaults to `min-height: auto` and
        would otherwise overflow the cap instead of scrolling inside it.
      */}
      <div
        className={cn(
          'min-h-0 min-w-0 overflow-x-auto rounded-lg border border-[var(--border)]',
          SURFACE_CLASS
        )}
      >
        <table className='w-full' aria-label={ariaLabel}>
          <colgroup>
            {multiSelection ? <col className='w-[34px]' /> : null}
            {columns.map((column) => (
              <col
                key={column.key}
                style={column.width === undefined ? undefined : { width: `${column.width}px` }}
              />
            ))}
          </colgroup>
          <thead className={chipFilledFillTokens}>
            {multiSelection ? (
              <tr className='border-[var(--border)] border-b'>
                <th className={HEADER_CELL_CLASS}>
                  <Checkbox
                    size='sm'
                    className={cn(FOCUS_RING_CLASS, SURFACE_CLASS)}
                    aria-label='Select all rows'
                    checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th colSpan={columns.length} className={HEADER_CELL_CLASS}>
                  <div className='flex items-center justify-between gap-2'>
                    <span>
                      {selectedCount > 0
                        ? `${selectedCount} selected of ${selectableCount}`
                        : `Select all (${selectableCount})`}
                    </span>
                    {multiSelection.bulkActions ? (
                      <div className='flex items-center gap-2'>{multiSelection.bulkActions}</div>
                    ) : null}
                  </div>
                </th>
              </tr>
            ) : null}
            {hasColumnHeaders ? (
              <tr className='border-[var(--border)] border-b'>
                {multiSelection ? <th scope='col' className={HEADER_CELL_CLASS} /> : null}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope='col'
                    className={cn(HEADER_CELL_CLASS, column.align === 'right' && 'text-right')}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {rows.length === 0 && empty !== undefined ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className='px-3 py-10 text-center text-[var(--text-muted)] text-small'
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const id = rowIds[index]
                const selectable = isRowSelectable ? isRowSelectable(row) : true
                const isSelected = singleSelection
                  ? singleSelection.selectedId === id
                  : selectedIdSet.has(id)
                /**
                 * Single-select makes the row itself the control, so it takes the
                 * click, the focus and the ARIA state — there is no checkbox
                 * column and no select-all band to carry them.
                 */
                const pickable = singleSelection !== undefined && selectable
                const pickProps = pickable
                  ? {
                      // `<tr>` already carries the implicit `row` role, which
                      // supports `aria-selected`. `option` would be a lie here
                      // — there is no listbox ancestor inside a `<table>`.
                      'aria-selected': isSelected,
                      tabIndex: 0,
                      onClick: () => singleSelection.onSelect(id),
                      onKeyDown: (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        singleSelection.onSelect(id)
                      },
                    }
                  : undefined
                return (
                  <tr
                    key={id}
                    className={cn(
                      'border-[var(--border)] border-b transition-colors last:border-b-0',
                      /**
                       * Rows never tint. Where a checkbox exists it is the whole
                       * selection signal, and a banded row on top of it is noise.
                       * Single-select is the exception: the row IS the control, so
                       * without a surface there would be nothing to show the choice.
                       */
                      pickable && [
                        'cursor-pointer',
                        FOCUS_RING_CLASS,
                        isSelected ? chipActiveSurfaceClass : chipHoverSurfaceClass,
                      ]
                    )}
                    {...pickProps}
                  >
                    {multiSelection ? (
                      <td className={CELL_CLASS}>
                        {selectable ? (
                          <Checkbox
                            size='sm'
                            className={cn(FOCUS_RING_CLASS, SURFACE_CLASS)}
                            aria-label='Select row'
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(id)}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          CELL_CLASS,
                          'text-[var(--text-body)] text-small',
                          column.align === 'right' && 'text-right'
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
