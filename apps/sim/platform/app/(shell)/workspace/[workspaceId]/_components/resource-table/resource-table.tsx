'use client'

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { Input } from '@sim/emcn/field/inputs'
import { Icon, type IconName } from '@sim/emcn/icon'
import { ActionMenu, ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useVirtualizer } from '@tanstack/react-virtual'
import Link from 'next/link'
import { ListEnd } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/list-end/list-end'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/resource-table.module.css'
import type { ResourceDrag } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/use-resource-drag'
import type { ResourceSelection } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/use-resource-selection'

/** Rows drawn beyond the viewport, so a fast scroll never shows a blank band. */
const OVERSCAN = 8
/** A row's resting height with its list gap, before it is measured. */
const ROW_ESTIMATE = 42
const LIST_GAP = 2
const FIRST_PAINT = { width: 0, height: 960 }

/** One of the list's typed columns, after the name. */
export interface ResourceColumn {
  id: string
  label: string
  /** Counts and sizes read against the trailing edge in tabular figures. */
  numeric?: boolean
  /**
   * `tight` for a short count such as "11.9k", `compact` for a count or size, `regular` (the
   * default) for a date or a person, `wide` for a path.
   */
  width?: 'tight' | 'compact' | 'regular' | 'wide'
  /** The first to go as the list narrows. */
  optional?: boolean
  /** Still shown at the narrowest width, where every other column gives way to the name. */
  narrow?: boolean
}

/** A folder or a resource. Folders open in place; resources navigate. */
export interface ResourceRow {
  /** Unique across both kinds: a folder's id comes from `folderRowId`. */
  id: string
  name: string
  /** An interface glyph, or a brand mark such as a connector's. */
  icon: IconName | { providerId: string }
  folder?: boolean
  pinned?: boolean
  /** Where the row leads. Without it the row runs `onOpen`, as a folder does. */
  href?: string
  onOpen?: () => void
  /** Each column's value, by column id. A missing value reads as an em dash. */
  cells: Readonly<Record<string, ReactNode>>
}

/** The row being renamed in place, from the page's rename session. */
interface RowRename {
  rowId: string
  value: string
  saving: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

interface ResourceTableProps {
  /** Names the list, such as "Tables". */
  label: string
  columns: readonly ResourceColumn[]
  rows: readonly ResourceRow[]
  /** A row's commands, offered from its ellipsis and on right-click. */
  rowActions?: (row: ResourceRow) => readonly MenuAction[]
  /** What a right-click on the list's background offers, such as New folder. */
  backgroundActions?: readonly MenuAction[]
  selection?: ResourceSelection
  /** Commands on the selection, in the bar that rises while rows are selected. */
  bulkActions?: readonly MenuAction[]
  /** The most rows one bulk command accepts; past it the bar says so and its commands rest. */
  bulkLimit?: number
  /** The count the bar reports when it differs from the rows checked, as a server-wide select all. */
  bulkCount?: number
  rename?: RowRename | null
  drag?: ResourceDrag
  /** Quiet paging: arriving near the end asks for more. */
  loadMore?: { hasMore: boolean; onLoadMore: () => void }
  /** A find-in-list term to mark in names, and the match to bring into view. */
  find?: { query: string; activeId: string | null }
  /** What shows in place of rows when there are none; the background menu still covers it. */
  empty?: ReactNode
}

/**
 * The workspace's resource list, in the Logs run list's anatomy: a caption header, 40px rows with a
 * leading glyph and name, supporting values in secondary ink and numbers on the trailing edge.
 * Folder rows open in place and resource rows navigate. Rows carry their commands on an ellipsis and
 * on right-click, join a checkbox selection with a bulk bar, rename in place, move by drag and drop,
 * and render only what is near the viewport.
 */
export function ResourceTable({
  label,
  columns,
  rows,
  rowActions,
  backgroundActions,
  selection,
  bulkActions,
  bulkLimit,
  bulkCount,
  rename,
  drag,
  loadMore,
  find,
  empty,
}: ResourceTableProps) {
  const list = useRef<HTMLOListElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)
  const hasRows = rows.length > 0

  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const viewport = element.closest<HTMLElement>('[data-scroll-axis="vertical"]')
    setScroller(viewport)
    if (!viewport) return
    const measure = () => {
      const offset =
        element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop
      setMargin((current) => (Math.abs(current - offset) < 1 ? current : offset))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    const page = element.closest('main')
    if (page) observer.observe(page)
    return () => observer.disconnect()
  }, [hasRows])

  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    gap: LIST_GAP,
    scrollMargin: margin,
    getItemKey,
    initialRect: FIRST_PAINT,
    // Measuring a row as it mounts must not flush a render into a list still mounting.
    useFlushSync: false,
  })
  const items = virtualizer.getVirtualItems()
  const before = Math.max(0, (items[0]?.start ?? margin) - margin - LIST_GAP)
  const after = Math.max(
    0,
    virtualizer.getTotalSize() - ((items.at(-1)?.end ?? margin) - margin) - LIST_GAP
  )

  const activeFind = find?.activeId
  useEffect(() => {
    if (!activeFind) return
    const index = rows.findIndex((row) => row.id === activeFind)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [activeFind, rows, virtualizer])

  const selected = selection?.selected
  const selectedCount = selected?.size ?? 0
  const allSelected = hasRows && selectedCount >= rows.length
  const narrowed = columns.some((column) => column.narrow)

  const content = (
    <div
      className={styles.area}
      data-drop-target={drag?.bodyActive || undefined}
      onDragOver={drag?.body.onDragOver}
      onDragLeave={drag?.body.onDragLeave}
      onDrop={drag?.body.onDrop}
    >
      {hasRows ? (
        <div className={styles.table} data-narrowed={narrowed || undefined}>
          <div className={styles.header} data-type='T050'>
            {selection && (
              <span className={styles.check}>
                <Checkbox
                  label={`Select all ${label.toLowerCase()}`}
                  labelHidden
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onCheckedChange={selection.toggleAll}
                />
              </span>
            )}
            <span className={styles.name}>Name</span>
            {columns.map((column) => (
              <ColumnCell key={column.id} column={column}>
                {column.label}
              </ColumnCell>
            ))}
            {rowActions && <span className={styles.action} />}
          </div>
          <ol ref={list} className={styles.rows} aria-label={label}>
            {before > 0 && <Spacer blockSize={before} />}
            {items.map((item) => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <li key={item.key} ref={virtualizer.measureElement} data-index={item.index}>
                  <ResourceRowView
                    row={row}
                    columns={columns}
                    rowActions={rowActions}
                    selection={selection}
                    rename={rename?.rowId === row.id ? rename : null}
                    drag={drag}
                    find={find}
                  />
                </li>
              )
            })}
            {after > 0 && <Spacer blockSize={after} />}
          </ol>
          {loadMore && <ListEnd hasMore={loadMore.hasMore} onLoadMore={loadMore.onLoadMore} />}
        </div>
      ) : (
        empty
      )}
      {selection && selectedCount > 0 && bulkActions && bulkActions.length > 0 && (
        <BulkBar count={bulkCount ?? selectedCount} limit={bulkLimit} actions={bulkActions} />
      )}
      {drag && (
        <div ref={drag.ghost} className={styles.ghost} data-type='T060' aria-hidden='true' />
      )}
    </div>
  )

  return (
    <div className={styles.root}>
      {backgroundActions?.length ? (
        <ContextActionMenu label={`${label} actions`} actions={backgroundActions}>
          {content}
        </ContextActionMenu>
      ) : (
        content
      )}
    </div>
  )
}

/** Stands in for the rows outside the window, keeping the list's full height. */
function Spacer({ blockSize }: { blockSize: number }) {
  return (
    <li
      className={styles.spacer}
      aria-hidden='true'
      ref={(element) => {
        element?.style.setProperty('block-size', `${blockSize}px`)
      }}
    />
  )
}

interface ColumnCellProps {
  column: ResourceColumn
  /** A value cell takes the row's type; a header cell keeps the caption it sits in. */
  value?: boolean
  children: ReactNode
}

function ColumnCell({ column, value, children }: ColumnCellProps) {
  return (
    <span
      className={styles.cell}
      data-type={value ? 'T060' : undefined}
      data-width={column.width ?? 'regular'}
      data-numeric={column.numeric || undefined}
      data-optional={column.optional || undefined}
      data-narrow={column.narrow || undefined}
    >
      {children}
    </span>
  )
}

interface ResourceRowViewProps {
  row: ResourceRow
  columns: readonly ResourceColumn[]
  rowActions?: (row: ResourceRow) => readonly MenuAction[]
  selection?: ResourceSelection
  rename: RowRename | null
  drag?: ResourceDrag
  find?: { query: string; activeId: string | null }
}

function ResourceRowView({
  row,
  columns,
  rowActions,
  selection,
  rename,
  drag,
  find,
}: ResourceRowViewProps) {
  const extend = useRef(false)
  const isSelected = selection?.selected.has(row.id) ?? false
  const dragProps = drag?.row(row.id)
  const actions = rowActions && (() => rowActions(row))
  const retarget = (open: boolean) => {
    if (open && selection && !selection.selected.has(row.id)) selection.replace([row.id])
  }
  const name = <MarkedName name={row.name} query={find?.query} />
  const view = (
    <div
      className={styles.row}
      data-selected={isSelected || undefined}
      data-drop-target={drag?.targetId === row.id || undefined}
      data-dragged={drag?.dragged.has(row.id) || undefined}
      data-find-active={find?.activeId === row.id || undefined}
      draggable={dragProps?.draggable}
      onDragStart={dragProps?.onDragStart}
      onDragEnd={dragProps?.onDragEnd}
      onDragOver={dragProps?.onDragOver}
      onDragLeave={dragProps?.onDragLeave}
      onDrop={dragProps?.onDrop}
    >
      {selection && (
        <span
          className={styles.check}
          onClickCapture={(event: MouseEvent) => {
            extend.current = event.shiftKey
          }}
        >
          <Checkbox
            label={`Select ${row.name}`}
            labelHidden
            checked={isSelected}
            onCheckedChange={(checked) => selection.toggle(row.id, checked, extend.current)}
          />
        </span>
      )}
      <span className={styles.name} data-type='T060'>
        {typeof row.icon === 'string' ? (
          <Icon name={row.icon} />
        ) : (
          <Icon providerId={row.icon.providerId} />
        )}
        {rename ? (
          <RenameField rename={rename} name={row.name} />
        ) : row.href ? (
          <Link href={row.href} className={styles.open} draggable={false}>
            <OverflowText text={row.name}>{name}</OverflowText>
          </Link>
        ) : (
          <button type='button' className={styles.open} onClick={row.onOpen}>
            <OverflowText text={row.name}>{name}</OverflowText>
          </button>
        )}
        {row.pinned && !rename && (
          <span className={styles.pin}>
            <Icon name='I131' label='Pinned' />
          </span>
        )}
      </span>
      {columns.map((column) => (
        <ColumnCell key={column.id} column={column} value>
          <CellValue value={row.cells[column.id]} numeric={column.numeric} />
        </ColumnCell>
      ))}
      {actions && (
        <span className={styles.action}>
          <ActionMenu
            label={`Actions for ${row.name}`}
            icon='I108'
            triggerSize='compact'
            tooltip={false}
            align='end'
            actions={actions}
            onOpenChange={retarget}
          />
        </span>
      )}
    </div>
  )
  if (!actions) return view
  return (
    <ContextActionMenu label={`Actions for ${row.name}`} actions={actions} onOpenChange={retarget}>
      {view}
    </ContextActionMenu>
  )
}

/** A cell's value: text fades at the lane's edge with its full value on hover; none reads as a dash. */
function CellValue({ value, numeric }: { value: ReactNode; numeric?: boolean }) {
  if (value === null || value === undefined || value === false || value === '') return '—'
  if (typeof value === 'string' && !numeric)
    return <OverflowText text={value}>{value}</OverflowText>
  return value
}

/** A name with a find term's matches marked. */
function MarkedName({ name, query }: { name: string; query?: string }) {
  const needle = query?.trim().toLowerCase()
  if (!needle) return name
  const parts: ReactNode[] = []
  const lower = name.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(name.slice(from, at))
    parts.push(
      <mark key={at} className={styles.match}>
        {name.slice(at, at + needle.length)}
      </mark>
    )
    from = at + needle.length
  }
  if (from < name.length) parts.push(name.slice(from))
  return parts
}

function RenameField({ rename, name }: { rename: RowRename; name: string }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <span
      className={styles.rename}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          rename.onSubmit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          rename.onCancel()
        }
      }}
    >
      <Input
        label={`Rename ${name}`}
        placeholder={name}
        value={rename.value}
        onChange={rename.onChange}
        onBlur={rename.onSubmit}
        disabled={rename.saving}
        autoComplete='off'
        spellCheck={false}
        inputRef={input}
      />
    </span>
  )
}

interface BulkBarProps {
  count: number
  limit?: number
  actions: readonly MenuAction[]
}

/** The selection's commands, floating at the foot of the list as long as rows stay selected. */
function BulkBar({ count, limit, actions }: BulkBarProps) {
  const overLimit = limit !== undefined && count > limit
  return (
    <div className={styles.bulkFrame}>
      <div
        className={styles.bulk}
        role='toolbar'
        aria-label='Selection actions'
        data-material='floating'
        data-elevation='menu'
      >
        <span className={styles.count} data-type='T060' role='status'>
          {overLimit
            ? `${count} selected · select ${limit} or fewer`
            : `${count.toLocaleString()} selected`}
        </span>
        {actions.map((action) =>
          action.children ? (
            <ActionMenu
              key={action.id}
              label={action.label}
              triggerText={action.label}
              disabled={overLimit}
              actions={action.children}
            />
          ) : (
            <Button
              key={action.id}
              variant='quiet'
              size='compact'
              destructive={action.destructive}
              disabled={overLimit || action.disabled}
              disabledReason={action.disabledReason}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          )
        )}
      </div>
    </div>
  )
}

interface OwnerCellProps {
  name: string
  image?: string | null
}

/** A person in a value cell: their photo beside their name. */
export function OwnerCell({ name, image }: OwnerCellProps) {
  return (
    <span className={styles.person}>
      <Avatar name={name} src={image ?? undefined} size='inline' decorative />
      <OverflowText text={name}>{name}</OverflowText>
    </span>
  )
}
