'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zonedClockDate } from '@/lib/core/utils/timezone'
import {
  CalendarToolbar,
  MonthGrid,
  TimeGrid,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar/components'
import {
  buildCalendarGrid,
  type CalendarScope,
  formatScopeLabel,
  timeToOffset,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import type {
  CalendarEvent,
  ScheduledTask,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface ScheduleCalendarProps {
  scope: CalendarScope
  anchor: Date
  today: Date
  /** The viewer's effective timezone — positions the now-line and centering. */
  timezone: string
  onScopeChange: (scope: CalendarScope) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSelectDate: (date: Date) => void
  onSelectSlot: (date: Date, time?: string) => void
  /** A task pill was clicked — open its details modal. */
  onSelectTask: (task: ScheduledTask) => void
  /** A task pill was right-clicked — open its context menu at the cursor. */
  onTaskContextMenu: (task: ScheduledTask, e: React.MouseEvent) => void
  /** A month cell's overflow line was clicked — jump to that day's view. */
  onShowDay: (date: Date) => void
  /** Day-bucketed events feeding both the month grid and the time grid. */
  eventsByDay?: Map<string, CalendarEvent[]>
}

/**
 * Calendar body for the scheduled-tasks page. Owns the scroll region and view
 * dispatch: it renders the toolbar, derives the grid from the page's
 * `useCalendar` state, and switches between the month grid and the shared time
 * grid on the grid discriminant.
 *
 * Scroll behavior: entering week/day scope, and "Today" presses (signaled via an
 * internal `scrollSignal`), center the current time in the viewport; month scope
 * resets to the top. Plain prev/next navigation never re-centers. Today presses
 * scroll smoothly as an orientation cue; mount and scope switches position
 * instantly (animating initial placement would read as a glitch). Centering is
 * computed from the time-grid header height plus {@link timeToOffset} rather than
 * the now-line element, so it works even on first paint before the line mounts.
 *
 * Event injection is the single integration point — `eventsByDay` is threaded
 * straight into both grids, which forward it to their cells.
 */
export function ScheduleCalendar({
  scope,
  anchor,
  today,
  timezone,
  onScopeChange,
  onPrev,
  onNext,
  onToday,
  onSelectDate,
  onSelectSlot,
  onSelectTask,
  onTaskContextMenu,
  onShowDay,
  eventsByDay,
}: ScheduleCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastScrollSignalRef = useRef(0)
  const [scrollSignal, setScrollSignal] = useState(0)

  const grid = useMemo(() => buildCalendarGrid(scope, anchor, today), [scope, anchor, today])
  const label = useMemo(() => formatScopeLabel(scope, anchor), [scope, anchor])

  const handleToday = useCallback(() => {
    onToday()
    setScrollSignal((signal) => signal + 1)
  }, [onToday])

  useEffect(() => {
    const region = scrollRef.current
    if (!region) return
    const behavior: ScrollBehavior =
      scrollSignal !== lastScrollSignalRef.current ? 'smooth' : 'auto'
    lastScrollSignalRef.current = scrollSignal
    if (scope === 'month') {
      region.scrollTo({ top: 0, behavior })
      return
    }
    const header = region.querySelector('[data-time-grid-header]')
    const headerHeight = header ? header.getBoundingClientRect().height : 0
    const target =
      headerHeight + timeToOffset(zonedClockDate(new Date(), timezone)) - region.clientHeight / 2
    region.scrollTo({ top: Math.max(0, target), behavior })
  }, [scope, scrollSignal, timezone])

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <CalendarToolbar
        scope={scope}
        anchor={anchor}
        label={label}
        onPrev={onPrev}
        onNext={onNext}
        onToday={handleToday}
        onSelectDate={onSelectDate}
        onScopeChange={onScopeChange}
      />
      <div ref={scrollRef} className='min-h-0 flex-1 overflow-auto overscroll-none'>
        {grid.kind === 'month' ? (
          <MonthGrid
            grid={grid}
            onSelectDay={(date) => onSelectSlot(date)}
            onSelectTask={onSelectTask}
            onTaskContextMenu={onTaskContextMenu}
            onShowDay={onShowDay}
            eventsByDay={eventsByDay}
          />
        ) : (
          <TimeGrid
            days={grid.kind === 'week' ? grid.days : [grid.day]}
            hours={grid.hours}
            timezone={timezone}
            onSelectSlot={(date, time) => onSelectSlot(date, time)}
            onSelectTask={onSelectTask}
            onTaskContextMenu={onTaskContextMenu}
            eventsByDay={eventsByDay}
          />
        )}
      </div>
    </div>
  )
}
