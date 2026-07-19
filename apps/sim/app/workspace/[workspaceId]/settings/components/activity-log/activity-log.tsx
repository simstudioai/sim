'use client'

import { type ReactNode, useState } from 'react'
import { cn } from '@sim/emcn'
import { ChevronDown } from 'lucide-react'
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

function ActivityLogRow({
  entry,
  eventColumn,
}: {
  entry: ActivityLogEntry
  eventColumn: EventColumnWidth
}) {
  const [expanded, setExpanded] = useState(false)
  const expandable = entry.details != null

  return (
    <div
      className={cn(
        'rounded-md transition-colors',
        expandable && 'hover-hover:bg-[var(--surface-2)]',
        expanded && 'bg-[var(--surface-2)]'
      )}
    >
      <button
        type='button'
        className='flex w-full items-center gap-3 px-3 py-2 text-left'
        onClick={() => expandable && setExpanded(!expanded)}
        disabled={!expandable}
      >
        <span className='w-[160px] flex-shrink-0 text-[var(--text-secondary)] text-small'>
          {entry.timestamp}
        </span>
        <span className={cn(EVENT_COLUMN_WIDTH_CLASS[eventColumn], 'flex-shrink-0')}>
          {entry.event}
        </span>
        <span className='min-w-0 flex-1 text-[var(--text-primary)] text-small'>
          {typeof entry.description === 'string' ? (
            <FloatingOverflowText label={entry.description} className='block truncate' />
          ) : (
            entry.description
          )}
        </span>
        <span className='flex w-[160px] flex-shrink-0 items-center justify-end gap-1.5 text-[var(--text-secondary)] text-small'>
          {typeof entry.actor === 'string' ? (
            <FloatingOverflowText label={entry.actor} className='block min-w-0 truncate' />
          ) : (
            <span className='min-w-0 truncate'>{entry.actor}</span>
          )}
          {expandable && (
            <ChevronDown
              className={cn(
                'size-[14px] flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                expanded && 'rotate-180'
              )}
            />
          )}
        </span>
      </button>
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
  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-3 px-3 pb-1 text-[var(--text-tertiary)] text-caption'>
        <span className='w-[160px] flex-shrink-0'>Timestamp</span>
        <span className={cn(EVENT_COLUMN_WIDTH_CLASS[eventColumn], 'flex-shrink-0')}>
          {eventLabel}
        </span>
        <span className='min-w-0 flex-1'>{descriptionLabel}</span>
        <span className='w-[160px] flex-shrink-0 text-right'>Actor</span>
      </div>

      {entries.length === 0 ? (
        emptyState
      ) : (
        <div className='flex flex-col gap-0.5'>
          {entries.map((entry) => (
            <ActivityLogRow key={entry.id} entry={entry} eventColumn={eventColumn} />
          ))}
          {footer}
        </div>
      )}
    </div>
  )
}
