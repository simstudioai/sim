'use client'

import { type ReactNode, useState } from 'react'
import { cn } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components'

/**
 * One row of an activity/audit log. `details`, when present, renders inside the
 * expandable bordered box below the row; omit it to make the row non-expandable.
 */
export interface ActivityLogEntry {
  id: string
  timestamp: ReactNode
  /** Leading badge conveying the action/status (typically a `Badge`). */
  event: ReactNode
  description: ReactNode
  actor: ReactNode
  details?: ReactNode
  /**
   * Row action (typically a `Chip`/`ChipLink`) in a trailing column after every
   * data column. The column appears as soon as any entry supplies one, and the
   * header reserves the same width so the Actor column stays aligned.
   */
  trailing?: ReactNode
}

/**
 * Event-column width presets, shared by the header and every row so the column
 * stays aligned: `wide` fits the audit log's long action badges; `compact` suits
 * short operation badges (Fork / Push / Rollback), returning the spare width to
 * the flexible description column.
 */
const EVENT_COLUMN_WIDTH_CLASS = {
  wide: 'w-[180px]',
  compact: 'w-[90px]',
} as const

type EventColumnWidth = keyof typeof EVENT_COLUMN_WIDTH_CLASS

/** Trailing row-action column, wide enough for a chip without wrapping its label. */
const TRAILING_COLUMN_WIDTH_CLASS = 'w-[100px]'

const ROW_CLASS = 'flex w-full items-center gap-3 px-3 py-2 text-left'

function ActivityLogRow({
  entry,
  eventColumn,
  hasTrailingColumn,
}: {
  entry: ActivityLogEntry
  eventColumn: EventColumnWidth
  hasTrailingColumn: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const expandable = entry.details != null

  const cells = (
    <>
      <span className='w-[160px] shrink-0 text-[var(--text-secondary)] text-small'>
        {entry.timestamp}
      </span>
      <span className={cn(EVENT_COLUMN_WIDTH_CLASS[eventColumn], 'shrink-0')}>{entry.event}</span>
      <span className='min-w-0 flex-1 text-[var(--text-primary)] text-small'>
        {typeof entry.description === 'string' ? (
          <FloatingOverflowText label={entry.description} className='block' />
        ) : (
          entry.description
        )}
      </span>
      <span className='flex w-[160px] shrink-0 items-center justify-end gap-1.5 text-[var(--text-secondary)] text-small'>
        {typeof entry.actor === 'string' ? (
          <FloatingOverflowText label={entry.actor} className='block' />
        ) : (
          <span className='min-w-0 truncate'>{entry.actor}</span>
        )}
        {expandable && (
          <ChevronDown
            className={cn(
              'size-[14px] shrink-0 text-[var(--text-muted)] transition-transform duration-200',
              expanded && 'rotate-180'
            )}
          />
        )}
      </span>
    </>
  )

  return (
    <div
      className={cn(
        'rounded-md transition-colors',
        expandable && 'hover-hover:bg-[var(--surface-2)]',
        expanded && 'bg-[var(--surface-2)]'
      )}
    >
      {/*
        The trailing action is a SIBLING of the expand button, never a child: a link
        or button nested inside another button is invalid, and the inner control's
        click would toggle the row on its way up.
      */}
      <div className={cn('flex items-center', hasTrailingColumn && 'gap-3 pr-3')}>
        {expandable ? (
          <button
            type='button'
            aria-expanded={expanded}
            className={cn(ROW_CLASS, 'min-w-0 flex-1', hasTrailingColumn && 'pr-0')}
            onClick={() => setExpanded(!expanded)}
          >
            {cells}
          </button>
        ) : (
          // A row with nothing to expand is inert content, not a disabled control:
          // browsers suppress pointer events over a disabled button AND its
          // descendants, which would swallow the hover tooltips inside the cells.
          <div className={cn(ROW_CLASS, 'min-w-0 flex-1', hasTrailingColumn && 'pr-0')}>
            {cells}
          </div>
        )}
        {hasTrailingColumn && (
          <span
            className={cn(TRAILING_COLUMN_WIDTH_CLASS, 'flex shrink-0 items-center justify-end')}
          >
            {entry.trailing}
          </span>
        )}
      </div>
      {expandable && expanded && (
        <div className='px-3 pb-2'>
          <div className='flex flex-col gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-3)] p-3 text-small'>
            {entry.details}
          </div>
        </div>
      )}
    </div>
  )
}

export interface ActivityLogProps {
  entries: ActivityLogEntry[]
  /** Header label for the badge column. */
  eventLabel?: string
  /** Header label for the wide middle column. */
  descriptionLabel?: string
  /** Badge-column width preset; use `compact` when every badge is a short word. Defaults to `wide`. */
  eventColumn?: EventColumnWidth
  /** Rendered below the header when there are no entries (the header stays visible). */
  emptyState?: ReactNode
  /** Rendered after the rows (e.g. a "Load more" control). */
  footer?: ReactNode
}

/**
 * Canonical expandable activity/audit-log table: a four-column header
 * (Timestamp / event / description / Actor) over rows that expand to a bordered
 * detail box. Shared by the enterprise audit log and the fork Activity view so
 * both read identically — callers own data fetching and map their rows to
 * {@link ActivityLogEntry}.
 */
export function ActivityLog({
  entries,
  eventLabel = 'Event',
  descriptionLabel = 'Description',
  eventColumn = 'wide',
  emptyState,
  footer,
}: ActivityLogProps) {
  const hasTrailingColumn = entries.some((entry) => entry.trailing != null)

  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-3 px-3 pb-1 text-[var(--text-tertiary)] text-caption'>
        <span className='w-[160px] shrink-0'>Timestamp</span>
        <span className={cn(EVENT_COLUMN_WIDTH_CLASS[eventColumn], 'shrink-0')}>{eventLabel}</span>
        <span className='min-w-0 flex-1'>{descriptionLabel}</span>
        <span className='w-[160px] shrink-0 text-right'>Actor</span>
        {/* Row actions carry no header, but the column must still be reserved
            here or every label above would sit left of the data below it. */}
        {hasTrailingColumn && (
          <span className={cn(TRAILING_COLUMN_WIDTH_CLASS, 'shrink-0')} aria-hidden />
        )}
      </div>

      {entries.length === 0 ? (
        emptyState
      ) : (
        <div className='flex flex-col gap-0.5'>
          {entries.map((entry) => (
            <ActivityLogRow
              key={entry.id}
              entry={entry}
              eventColumn={eventColumn}
              hasTrailingColumn={hasTrailingColumn}
            />
          ))}
          {footer}
        </div>
      )}
    </div>
  )
}
