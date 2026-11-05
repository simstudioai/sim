'use client'

import { memo, type ReactNode, type Ref, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import Link from 'next/link'
import styles from '@/platform/design-system/components/data-display/data-display.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { LoadMoreFooter } from '@/platform/design-system/components/scroll-area/load-more-footer'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'
import type { LoadMoreState } from '@/platform/design-system/components/scroll-area/use-load-more'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface MetricGroupProps {
  metrics: readonly { label: string; value: string | number }[]
}

export function MetricGroup({ metrics }: MetricGroupProps) {
  return (
    <dl className={styles.metrics}>
      {metrics.map(({ label, value }) => (
        <div className={styles.metric} key={label}>
          <dt data-type='T050'>{label}</dt>
          <dd data-type='T102'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface TableLabelProps {
  leading?: ReactNode
  children: ReactNode
}

/** A table cell's name with its avatar, favicon or provider mark. */
export function TableLabel({ leading, children }: TableLabelProps) {
  return (
    <span className={styles.label}>
      {leading}
      {children}
    </span>
  )
}

type TableColumn = {
  key: string
  label: string
  showFrom?: 'compact' | 'wide'
  /** The column a row is read by, wider than the columns that share the rest. */
  primary?: boolean
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
  /** Content for a column in place of its formatted value. Interactive content goes in `action`. */
  cells?: Readonly<Partial<Record<string, ReactNode>>>
  /** Make the whole row open this destination, through a link on its first cell. */
  href?: string
  /** Make the whole row run this, through a button on its first cell. */
  onOpen?: () => void
  /** A control beside the row's target, in a trailing column. */
  action?: ReactNode
}

interface TableSort {
  column: string
  direction: 'asc' | 'desc'
}

interface DataTableProps {
  title: string
  /** Name the table for assistive technology only, where the page already titles it. */
  titleHidden?: boolean
  control?: ReactNode
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
}

const TableRowView = memo(function TableRowView({
  row,
  fields,
  actionColumn,
  rowChevron,
  index,
  rowRef,
}: TableRowViewProps) {
  return (
    <tr
      ref={rowRef}
      data-index={index}
      aria-rowindex={index === undefined ? undefined : index + 2}
      data-openable={row.href || row.onOpen ? true : undefined}
    >
      {fields.map((column, position) => {
        const custom = row.cells?.[column.key]
        const content =
          custom === undefined ? cellText(row.values[column.key], column.format) : custom
        return (
          <td
            key={column.key}
            data-kind={column.kind}
            data-from={column.showFrom}
            data-primary={column.primary || undefined}
            data-numeric={Boolean(column.format)}
            data-type={column.kind === 'text' ? 'T059' : 'T060'}
          >
            {position === 0 && row.href ? (
              <Link href={row.href} className={styles.rowTarget}>
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
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending', none: 'none' } as const

function TableHead({ fields, actionColumn, sort, onSortChange }: TableHeadProps) {
  return (
    <thead>
      <tr>
        {fields.map((column) => {
          const sortable = column.sortable && onSortChange
          const direction = sort?.column === column.key ? sort.direction : undefined
          return (
            <th
              key={column.key}
              scope='col'
              aria-sort={sortable ? ARIA_SORT[direction ?? 'none'] : undefined}
              data-kind={column.kind}
              data-from={column.showFrom}
              data-primary={column.primary || undefined}
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
        {actionColumn && (
          <th scope='col' data-kind='action' data-type='T050'>
            <span data-visually-hidden>Actions</span>
          </th>
        )}
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
  const columnCount = fields.length + (actionColumn ? 1 : 0)
  return (
    <div
      ref={scrollRef}
      className={styles.virtualViewport}
      data-sticky-head
      role='region'
      aria-label={title}
    >
      <table className={styles.table} aria-label={title} aria-rowcount={rows.length + 1}>
        <TableHead
          fields={fields}
          actionColumn={actionColumn}
          sort={sort}
          onSortChange={onSortChange}
        />
        <tbody>
          <VirtualSpacer blockSize={before} columnCount={columnCount} />
          {items.map((item) => (
            <TableRowView
              key={item.key}
              row={rows[item.index]}
              fields={fields}
              actionColumn={actionColumn}
              rowChevron={rowChevron}
              index={item.index}
              rowRef={virtualizer.measureElement}
            />
          ))}
          <VirtualSpacer blockSize={after} columnCount={columnCount} />
        </tbody>
      </table>
      {loadMore && <LoadMoreFooter state={loadMore} />}
    </div>
  )
}

interface VirtualSpacerProps {
  blockSize: number
  columnCount: number
}

/** Stands in for rows outside the window, keeping the native table's scroll height. */
function VirtualSpacer({ blockSize, columnCount }: VirtualSpacerProps) {
  if (blockSize <= 0) return null
  return (
    <tr
      className={styles.spacer}
      ref={(row) => {
        row?.style.setProperty('block-size', `${blockSize}px`)
      }}
    >
      <td colSpan={columnCount} />
    </tr>
  )
}

export function DataTable({
  title,
  titleHidden,
  control,
  locale = 'en-US',
  columns,
  rows,
  sort,
  onSortChange,
  loadMore,
  virtualized,
  rowChevron,
}: DataTableProps) {
  const fields = columns.map((column) => ({ ...column, format: columnFormat(column, locale) }))
  const actionColumn = Boolean(rowChevron) || rows.some((row) => row.action)
  return (
    <section className={styles.section}>
      {(!titleHidden || control) && (
        <header className={styles.header}>
          {!titleHidden && <h2 data-type='T042'>{title}</h2>}
          {control}
        </header>
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
          />
        ) : (
          <>
            <ScrollArea label={title} axis='horizontal'>
              <table className={styles.table} aria-label={title}>
                <TableHead
                  fields={fields}
                  actionColumn={actionColumn}
                  sort={sort}
                  onSortChange={onSortChange}
                />
                <tbody>
                  {rows.map((row) => (
                    <TableRowView
                      key={row.id}
                      row={row}
                      fields={fields}
                      actionColumn={actionColumn}
                      rowChevron={rowChevron}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {loadMore && <LoadMoreFooter state={loadMore} />}
          </>
        )}
      </div>
    </section>
  )
}
