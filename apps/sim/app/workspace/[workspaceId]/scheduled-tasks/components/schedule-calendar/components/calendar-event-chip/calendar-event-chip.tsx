'use client'

import { format } from 'date-fns'
import { cn } from '@/lib/core/utils/cn'
import type { CalendarEvent } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface CalendarEventChipProps {
  event: CalendarEvent
}

/**
 * Compact event pill rendered inside a month day cell or a time-grid slot — the
 * one leaf shared by both grids. The calendar feeds it real events once schedule
 * injection is enabled.
 */
export function CalendarEventChip({ event }: CalendarEventChipProps) {
  return (
    <span
      className={cn(
        'flex w-full min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-caption',
        'bg-[var(--surface-5)] text-[var(--text-body)] dark:bg-[var(--surface-4)]'
      )}
    >
      <span className='flex-shrink-0 text-[var(--text-muted)] text-micro'>
        {format(event.start, 'h:mm a')}
      </span>
      <span className='min-w-0 truncate'>{event.title}</span>
    </span>
  )
}
