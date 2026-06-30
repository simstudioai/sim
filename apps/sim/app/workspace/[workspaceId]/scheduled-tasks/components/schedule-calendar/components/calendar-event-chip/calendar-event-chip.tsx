'use client'
import { chipContentGap, chipPrimaryFillTokens, cn } from '@sim/emcn'
import { format } from 'date-fns'
import type {
  CalendarEvent,
  ScheduledTask,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface CalendarEventChipProps {
  event: CalendarEvent
  onSelect: (task: ScheduledTask) => void
  /** Right-click — open the task's context menu at the cursor. */
  onContextMenu: (task: ScheduledTask, e: React.MouseEvent) => void
  /** Layout/sizing only (`w-full`, `min-w-0 flex-1`); chrome lives here. */
  className?: string
}

/**
 * Compact task pill rendered inside a month day cell or a time-grid slot — the
 * one leaf shared by both grids. Every task renders identically regardless of
 * status — plaintext start time + title, no icons or status colors; the
 * details modal carries the state. The pill is the grid's real `<button>` (its
 * parent cells are plain clickable `<div>`s), so tasks are the tab-reachable
 * elements; clicks stop propagating so the cell underneath doesn't also open
 * the create modal. A paused task (`task.disabled`) renders dimmed — the one
 * status the pill signals visually, since a paused task can sit on the calendar
 * indefinitely without running.
 */
export function CalendarEventChip({
  event,
  onSelect,
  onContextMenu,
  className,
}: CalendarEventChipProps) {
  return (
    <button
      type='button'
      onClick={(e) => {
        e.stopPropagation()
        onSelect(event.task)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(event.task, e)
      }}
      className={cn(
        'flex min-w-0 cursor-pointer items-center truncate rounded-md px-1.5 py-0.5 text-left text-caption outline-none transition-colors',
        chipContentGap,
        chipPrimaryFillTokens,
        'hover-hover:bg-[var(--text-body)] dark:hover-hover:bg-[var(--text-secondary)]',
        event.task.disabled && 'opacity-45',
        className
      )}
    >
      <span className='flex-shrink-0'>{format(event.start, 'h:mm a')}</span>
      <span className='min-w-0 truncate'>{event.title}</span>
    </button>
  )
}
