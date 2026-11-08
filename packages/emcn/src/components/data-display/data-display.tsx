'use client'

import { type CSSProperties, memo, type ReactNode, type Ref, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import Link from 'next/link'
import { IconButton } from '#emcn/components/button/button'
import { Checkbox } from '#emcn/components/checkbox/checkbox'
import styles from '#emcn/components/data-display/data-display.module.css'
import { Icon } from '#emcn/components/icon/icon'
import { LoadMoreFooter } from '#emcn/components/scroll-area/load-more-footer'
import { ScrollArea } from '#emcn/components/scroll-area/scroll-area'
import type { LoadMoreState } from '#emcn/components/scroll-area/use-load-more'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { ContentTabs } from '#emcn/components/tabs/content-tabs'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

interface MetricGroupProps {
  metrics: readonly { label: string; value: string | number; description?: string }[]
}

export function MetricGroup({ metrics }: MetricGroupProps) {
  return (
    <dl className={styles.metrics}>
      {metrics.map(({ label, value, description }) => (
        <div className={styles.metric} key={label}>
          <dt className={styles.metricLabel} data-type='T050'>
            {label}
            {description && (
              <Tooltip label={description}>
                <IconButton icon='I047' label={`About ${label.toLowerCase()}`} size='inline' />
              </Tooltip>
            )}
          </dt>
          <dd data-type='T076'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface TableLabelProps {
  leading?: ReactNode
  children: ReactNode
  /** Keep a related hidden column readable below the compact table breakpoint. */
  compactDetail?: ReactNode
}

/** A table cell's name with its avatar, favicon or provider mark. */
export function TableLabel({ leading, children, compactDetail }: TableLabelProps) {
  return (
    <span className={styles.label}>
      {leading}
      {compactDetail ? (
        <span className={styles.labelBody}>
          <span>{children}</span>
          <span className={styles.compactDetail}>{compactDetail}</span>
        </span>
      ) : (
        children
      )}
    </span>
  )
}

type TableColumn = {
  key: string
  label: string
  showFrom?: 'compact' | 'wide'
  /** The column's share of a table wide enough for every column; narrower tables split evenly. */
  share?: `${number}%`
  /** The column a row is read by, wider than the columns that share the rest. */
  primary?: boolean
  /** Prefer a readable width while sharing narrower space with the other columns. */
  width?: 'compact' | 'regular'
  /** Offer this column to `onSortChange`. The caller owns the order of `rows`. */
  sortable?: boolean
} & (
  | { kind: 'text' | 'status' | 'number' | 'percent' }
  | { kind: 'duration'; unit: 'millisecond' | 'second' | 'minute' | 'hour' | 'day' }
  | { kind: 'currency'; currency: string }
)

interface TableRow {
  id: string
  values: Readonly<Partial<Record<string, string | number | null>>>
  /** Custom cell content. Whole-row targets keep independent controls in `action`. */
  cells?: Readonly<Partial<Record<string, ReactNode>>>
  selectionDisabled?: boolean
  /** Explain why this row cannot join a bulk selection. */
  selectionDisabledReason?: string
  /** Make the whole row open this destination, through a link on its first cell. */
  href?: string
  /** Hold the link's prefetch, for a long list of the same route. */
  prefetch?: boolean
  /** Make the whole row run this, through a button on its first cell. */
  onOpen?: () => void
  /** A control beside the row's target, in a trailing column. */
  action?: ReactNode
}

interface TableSort {
  column: string
  direction: 'asc' | 'desc'
}

interface TableSelection {
  /** Select-all changes only supplied, enabled rows and preserves selection outside this view. */
  selectedIds: readonly string[]
  onChange: (ids: string[]) => void
  rowLabel: (row: TableRow) => string
  /** Controls revealed for a nonempty selection; the caller owns their availability and behavior. */
  actions?: ReactNode
}

interface TableTabs {
  label: string
  items: readonly { id: string; label: string }[]
  current: string
  onSelect: (id: string) => void
}

interface DataTableProps {
  title: string
  /** Name the table for assistive technology only, where the page already titles it. */
  titleHidden?: boolean
  control?: ReactNode
  tabs?: TableTabs
  /** Search controls in the leading toolbar group. */
  toolbar?: ReactNode
  /** Persistent trailing controls, after any selection actions. */
  toolbarEnd?: ReactNode
  selection?: TableSelection
  locale?: string
  columns: readonly TableColumn[]
  rows: readonly TableRow[]
  sort?: TableSort
  onSortChange?: (sort: TableSort) => void
  loadMore?: LoadMoreState
  /** Window a long list inside a bounded scroller with a sticky header. */
  virtualized?: boolean
  /** Mark rows that open a destination with a trailing chevron, at every width. */
  rowChevron?: boolean
  /** Keep the trailing action column present when filtering removes every row. */
  rowActions?: boolean
}

function columnFormat(column: TableColumn, locale: string) {
  switch (column.kind) {
    case 'percent':
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: column.currency,
        minimumFractionDigits: 0,
      })
    case 'duration':
      return new Intl.NumberFormat(locale, { style: 'unit', unit: column.unit })
    case 'number':
      return new Intl.NumberFormat(locale)
    default:
      return null
  }
}

function cellText(value: string | number | null | undefined, format: Intl.NumberFormat | null) {
  if (format)
    return typeof value === 'number' && Number.isFinite(value) ? format.format(value) : '—'
  return value === '' || value == null ? '—' : value
}

type TableField = TableColumn & { format: Intl.NumberFormat | null }

interface TableRowViewProps {
  row: TableRow
  fields: readonly TableField[]
  actionColumn: boolean
  rowChevron?: boolean
  index?: number
  rowRef?: Ref<HTMLTableRowElement>
  selection?: TableSelection
  selected?: boolean
}

const TableRowView = memo(function TableRowView({
  row,
  fields,
  actionColumn,
  rowChevron,
  index,
  rowRef,
  selection,
  selected,
}: TableRowViewProps) {
  return (
    <tr
      ref={rowRef}
      data-index={index}
      aria-rowindex={index === undefined ? undefined : index + 2}
      data-openable={row.href || row.onOpen ? true : undefined}
    >
      {selection && (
        <td data-kind='selection'>
          <Checkbox
            label={`Select ${selection.rowLabel(row)}`}
            labelHidden
            checked={selected}
            disabled={row.selectionDisabled}
            disabledReason={row.selectionDisabledReason}
            onCheckedChange={(checked) =>
              selection.onChange(
                checked
                  ? [...new Set([...selection.selectedIds, row.id])]
                  : selection.selectedIds.filter((id) => id !== row.id)
              )
            }
          />
        </td>
      )}
      {fields.map((column, position) => {
        const custom = row.cells?.[column.key]
        const content =
          custom === undefined ? cellText(row.values[column.key], column.format) : custom
        const empty = content === '—'
        return (
          <td
            key={column.key}
            data-kind={column.kind}
            data-label={column.label}
            data-from={column.showFrom}
            data-primary={column.primary || undefined}
            data-column-width={column.width}
            data-numeric={Boolean(column.format)}
            data-empty={empty || undefined}
            data-type='T060'
          >
            {position === 0 && row.href ? (
              <Link href={row.href} prefetch={row.prefetch} className={styles.rowTarget}>
                {content}
              </Link>
            ) : position === 0 && row.onOpen ? (
              <button type='button' className={styles.rowTarget} onClick={row.onOpen}>
                {content}
              </button>
            ) : (
              content
            )}
          </td>
        )
      })}
      {actionColumn && (
        <td data-kind='action' data-passive={row.action ? undefined : true}>
          {row.action ?? (rowChevron && <Icon name='I032' />)}
        </td>
      )}
    </tr>
  )
})

interface TableHeadProps {
  fields: readonly TableField[]
  actionColumn: boolean
  sort?: TableSort
  onSortChange?: (sort: TableSort) => void
  selectionControl?: ReactNode
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending', none: 'none' } as const

function TableHead({ fields, actionColumn, sort, onSortChange, selectionControl }: TableHeadProps) {
  return (
    <thead>
      <tr>
        {selectionControl && (
          <th scope='col' data-kind='selection'>
            {selectionControl}
          </th>
        )}
        {fields.map((column) => {
          const sortable = column.sortable && onSortChange
          const direction = sort?.column === column.key ? sort.direction : undefined
          return (
            <th
              key={column.key}
              scope='col'
              style={
                column.share ? ({ '--column-width': column.share } as CSSProperties) : undefined
              }
              data-width={column.share ? true : undefined}
              aria-sort={sortable ? ARIA_SORT[direction ?? 'none'] : undefined}
              data-kind={column.kind}
              data-from={column.showFrom}
              data-primary={column.primary || undefined}
              data-column-width={column.width}
              data-numeric={Boolean(column.format)}
              data-type='T050'
            >
              {sortable ? (
                <button
                  type='button'
                  className={styles.sort}
                  onClick={() =>
                    onSortChange({
                      column: column.key,
                      direction: direction === 'asc' ? 'desc' : 'asc',
                    })
                  }
                >
                  {column.label}
                  {direction && <Icon name={direction === 'asc' ? 'I023' : 'I102'} />}
                </button>
              ) : (
                column.label
              )}
            </th>
          )
        })}
        {actionColumn && <th scope='col' data-kind='action' aria-label='Actions' />}
      </tr>
    </thead>
  )
}

const ROW_HEIGHT_ESTIMATE = 40
const ROW_OVERSCAN = 8
/** First-paint window, so a server render holds rows rather than an empty table. */
const INITIAL_VIEWPORT = { width: 0, height: 640 }

interface VirtualTableProps extends TableHeadProps {
  title: string
  rows: readonly TableRow[]
  loadMore?: LoadMoreState
  rowChevron?: boolean
  selection?: TableSelection
  selectedIds: ReadonlySet<string>
}

function VirtualTable({
  title,
  rows,
  fields,
  actionColumn,
  sort,
  onSortChange,
  loadMore,
  rowChevron,
  selection,
  selectionControl,
  selectedIds,
}: VirtualTableProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const scrollRef = useScrollEdges('vertical', { viewport, tabStop: true })
  const getItemKey = useCallback((index: number) => rows[index].id, [rows])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: ROW_OVERSCAN,
    getItemKey,
    initialRect: INITIAL_VIEWPORT,
  })
  const items = virtualizer.getVirtualItems()
  const before = items[0]?.start ?? 0
  const after = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0)
  return (
    <div
      ref={scrollRef}
      className={styles.virtualViewport}
      data-sticky-head
      role='region'
      aria-label={title}
    >
      <table
        className={styles.table}
        aria-label={title}
        aria-rowcount={rows.length + 1}
        data-columns={fields.length}
        data-sized-columns={fields.some((field) => field.share) || undefined}
      >
        <TableHead
          fields={fields}
          actionColumn={actionColumn}
          sort={sort}
          onSortChange={onSortChange}
          selectionControl={selectionControl}
        />
        <tbody>
          <VirtualSpacer blockSize={before} fields={fields} actionColumn={actionColumn} />
          {items.map((item) => (
            <TableRowView
              key={item.key}
              row={rows[item.index]}
              fields={fields}
              actionColumn={actionColumn}
              rowChevron={rowChevron}
              index={item.index}
              rowRef={virtualizer.measureElement}
              selection={selection}
              selected={selectedIds.has(rows[item.index].id)}
            />
          ))}
          <VirtualSpacer blockSize={after} fields={fields} actionColumn={actionColumn} />
        </tbody>
      </table>
      {loadMore && <LoadMoreFooter state={loadMore} />}
    </div>
  )
}

interface VirtualSpacerProps {
  blockSize: number
  fields: readonly TableField[]
  actionColumn: boolean
}

/**
 * Stands in for rows outside the window, keeping the native table's scroll height. One cell per
 * column, hidden with its column: a spanning cell would make a fixed table lay out every hidden
 * column as an empty one, squeezing the visible ones.
 */
function VirtualSpacer({ blockSize, fields, actionColumn }: VirtualSpacerProps) {
  if (blockSize <= 0) return null
  return (
    <tr
      className={styles.spacer}
      ref={(row) => {
        row?.style.setProperty('block-size', `${blockSize}px`)
      }}
    >
      {fields.map((column) => (
        <td key={column.key} data-from={column.showFrom} />
      ))}
      {actionColumn && <td />}
    </tr>
  )
}

export function DataTable({
  title,
  titleHidden,
  control,
  tabs,
  toolbar,
  toolbarEnd,
  selection,
  locale = 'en-US',
  columns,
  rows,
  sort,
  onSortChange,
  loadMore,
  virtualized,
  rowChevron,
  rowActions,
}: DataTableProps) {
  const fields = columns.map((column) => ({ ...column, format: columnFormat(column, locale) }))
  const actionColumn = Boolean(rowActions || rowChevron) || rows.some((row) => row.action)
  const selectedIds = new Set(selection?.selectedIds)
  const selectable = rows.filter((row) => !row.selectionDisabled)
  const selectedCount = selectable.filter((row) => selectedIds.has(row.id)).length
  const selectionControl = selection && (
    <Checkbox
      label={`Select all ${title.toLowerCase()}`}
      labelHidden
      checked={selectable.length > 0 && selectedCount === selectable.length}
      indeterminate={selectedCount > 0 && selectedCount < selectable.length}
      disabled={!selectable.length}
      disabledReason={rows.length ? 'No selectable rows in this view.' : undefined}
      onCheckedChange={(checked) => {
        const next = new Set(selectedIds)
        for (const row of selectable) {
          if (checked) next.add(row.id)
          else next.delete(row.id)
        }
        selection.onChange([...next])
      }}
    />
  )
  const content = (
    <div className={styles.body}>
      {(toolbar || toolbarEnd || selection) && (
        <div className={styles.toolbar}>
          {toolbar && <div className={styles.toolbarControls}>{toolbar}</div>}
          {(selection || toolbarEnd) && (
            <div className={styles.toolbarEnd}>
              {selection && (
                <div
                  className={styles.selectionActions}
                  role='group'
                  aria-label='Selection actions'
                  data-empty={selectedIds.size === 0 || undefined}
                  aria-hidden={selectedIds.size === 0 || undefined}
                  inert={selectedIds.size === 0}
                >
                  <span className={styles.selectionCount} data-type='T060'>
                    <span className={styles.countWidth} aria-hidden>
                      {Math.max(rows.length, selectedIds.size).toLocaleString(locale)} selected
                    </span>
                    <span role='status'>{selectedIds.size.toLocaleString(locale)} selected</span>
                  </span>
                  {selection.actions}
                </div>
              )}
              {toolbarEnd}
            </div>
          )}
        </div>
      )}
      <div className={styles.tableViewport}>
        {virtualized ? (
          <VirtualTable
            title={title}
            rows={rows}
            fields={fields}
            actionColumn={actionColumn}
            sort={sort}
            onSortChange={onSortChange}
            loadMore={loadMore}
            rowChevron={rowChevron}
            selection={selection}
            selectionControl={selectionControl}
            selectedIds={selectedIds}
          />
        ) : (
          <>
            <ScrollArea label={title} axis='horizontal'>
              <table
                className={styles.table}
                aria-label={title}
                data-columns={fields.length}
                data-sized-columns={fields.some((field) => field.share) || undefined}
              >
                <TableHead
                  fields={fields}
                  actionColumn={actionColumn}
                  sort={sort}
                  onSortChange={onSortChange}
                  selectionControl={selectionControl}
                />
                <tbody>
                  {rows.map((row) => (
                    <TableRowView
                      key={row.id}
                      row={row}
                      fields={fields}
                      actionColumn={actionColumn}
                      rowChevron={rowChevron}
                      selection={selection}
                      selected={selectedIds.has(row.id)}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {loadMore && <LoadMoreFooter state={loadMore} />}
          </>
        )}
      </div>
    </div>
  )
  return (
    <section className={styles.section}>
      {(!titleHidden || control) && (
        <header className={styles.header}>
          {!titleHidden && <h2 data-type='T042'>{title}</h2>}
          {control}
        </header>
      )}
      {tabs ? (
        <ContentTabs
          label={tabs.label}
          current={tabs.current}
          onSelect={tabs.onSelect}
          items={tabs.items.map((item) => ({
            ...item,
            content: item.id === tabs.current ? content : null,
          }))}
        />
      ) : (
        content
      )}
    </section>
  )
}
