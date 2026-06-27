'use client'

import { format } from 'date-fns'
import { useTranslations } from 'next-intl'
import { chipPrimaryFillTokens } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { CalendarEventChip } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar/components/calendar-event-chip'
import {
  type CalendarDayCell,
  type MonthGrid as MonthGridData,
  WEEKDAY_LABELS,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import {
  type CalendarEvent,
  dayKey,
  type ScheduledTask,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

/**
 * Lines of task content a month day cell shows before collapsing the rest
 * behind a "N more" overflow line. Capping at a fixed line count keeps every
 * cell's height contribution bounded no matter how many tasks pile onto a day.
 */
const MAX_DAY_EVENT_LINES = 3

interface MonthGridProps {
  grid: MonthGridData
  onSelectDay: (date: Date) => void
  onSelectTask: (task: ScheduledTask) => void
  /** A task pill was right-clicked — open its context menu at the cursor. */
  onTaskContextMenu: (task: ScheduledTask, e: React.MouseEvent) => void
  /** Drill into the day scope, where overflowing tasks have room to render. */
  onShowDay: (date: Date) => void
  eventsByDay?: Map<string, CalendarEvent[]>
}

/**
 * One day in the month grid. Clicking empty space opens the create modal; the
 * cell is a plain clickable `<div>` so the task pills inside can be real
 * `<button>`s without nesting interactive elements. Tasks stack vertically up
 * to {@link MAX_DAY_EVENT_LINES} lines — beyond that the last line becomes a
 * plaintext "N more" that jumps to the day view.
 *
 * The day number carries a 1px optical inset (`ml-px`) on top of the shared
 * `p-1.5` cell padding: digit glyphs and the cap-height weekday labels above
 * carry different side bearings, so box-flush alignment reads visibly off at
 * this size. 1px is the tuned value — 0 reads short of the label, 2px reads
 * past it.
 */
function DayCell({
  cell,
  events,
  colIndex,
  onSelect,
  onSelectTask,
  onTaskContextMenu,
  onShowDay,
}: {
  cell: CalendarDayCell
  events: CalendarEvent[]
  colIndex: number
  onSelect: (date: Date) => void
  onSelectTask: (task: ScheduledTask) => void
  onTaskContextMenu: (task: ScheduledTask, e: React.MouseEvent) => void
  onShowDay: (date: Date) => void
}) {
  const t = useTranslations('auto')
  const visible =
    events.length > MAX_DAY_EVENT_LINES ? events.slice(0, MAX_DAY_EVENT_LINES - 1) : events
  const hiddenCount = events.length - visible.length

  return (
    <div
      onClick={() => onSelect(cell.date)}
      className={cn(
        'flex min-h-0 min-w-0 cursor-pointer flex-col items-start gap-1 overflow-hidden border-[var(--border)] border-r border-b p-1.5 transition-colors hover-hover:bg-[var(--surface-active)]',
        colIndex === 0 && 'pl-6',
        colIndex === 6 && 'pr-6'
      )}
    >
      <span
        className={cn(
          'ml-px flex h-[26px] flex-shrink-0 items-center rounded-lg text-caption',
          cell.isToday
            ? cn('w-[26px] justify-center', chipPrimaryFillTokens)
            : cell.isCurrentMonth
              ? 'text-[var(--text-body)]'
              : 'text-[var(--text-muted)]'
        )}
      >
        {format(cell.date, 'd')}
      </span>
      <div className='flex w-full min-w-0 flex-col gap-0.5'>
        {visible.map((event) => (
          <CalendarEventChip
            key={event.id}
            event={event}
            onSelect={onSelectTask}
            onContextMenu={onTaskContextMenu}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type='button'
            onClick={(e) => {
              e.stopPropagation()
              onShowDay(cell.date)
            }}
            className='cursor-pointer px-1.5 py-0.5 text-left text-[var(--text-muted)] text-micro outline-none transition-colors hover-hover:text-[var(--text-body)]'
          >
            {hiddenCount} {t('more')}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Month scope: a sticky weekday header over a 7-column grid of day cells that
 * fills the body height. All seven tracks are equal, so the border-to-border
 * column rhythm is even; the edge cells span clear to the panel edges (the page
 * gutter stays hoverable and clickable) and inset their own content via
 * `pl-6`/`pr-6`. Events flow in via `eventsByDay` — the single injection point
 * the container fills.
 */
export function MonthGrid({
  grid,
  onSelectDay,
  onSelectTask,
  onTaskContextMenu,
  onShowDay,
  eventsByDay,
}: MonthGridProps) {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='sticky top-0 z-10 grid grid-cols-7 border-[var(--border)] border-b bg-[var(--bg)]'>
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              'p-1.5 text-[var(--text-muted)] text-caption',
              index === 0 && 'pl-6',
              index === WEEKDAY_LABELS.length - 1 && 'pr-6'
            )}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        className='grid min-h-0 flex-1 grid-cols-7'
        style={{ gridTemplateRows: `repeat(${grid.weeks.length}, minmax(0, 1fr))` }}
      >
        {grid.weeks.map((week) =>
          week.map((cell, colIndex) => (
            <DayCell
              key={cell.date.toISOString()}
              cell={cell}
              colIndex={colIndex}
              events={eventsByDay?.get(dayKey(cell.date)) ?? []}
              onSelect={onSelectDay}
              onSelectTask={onSelectTask}
              onTaskContextMenu={onTaskContextMenu}
              onShowDay={onShowDay}
            />
          ))
        )}
      </div>
    </div>
  )
}
