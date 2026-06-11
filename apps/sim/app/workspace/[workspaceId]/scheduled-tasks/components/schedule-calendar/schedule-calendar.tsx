'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { CalendarEvent } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface ScheduleCalendarProps {
  scope: CalendarScope
  anchor: Date
  today: Date
  onScopeChange: (scope: CalendarScope) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onSelectSlot: (date: Date, time?: string) => void
  /** Day-bucketed events for the month grid. Empty until injection is wired. */
  eventsByDay?: Map<string, CalendarEvent[]>
  /** Hour-bucketed events for the time grid. Empty until injection is wired. */
  eventsByHour?: Map<string, CalendarEvent[]>
}

/**
 * Calendar body for the scheduled-tasks page. Owns the scroll region and view
 * dispatch: it renders the toolbar, derives the grid from the page's
 * `useCalendar` state, and switches between the month grid and the shared time
 * grid on the grid discriminant.
 *
 * Scroll behavior: entering week/day scope, and "Today" presses (signaled via an
 * internal `scrollSignal`), center the current time in the viewport; month scope
 * resets to the top. Plain prev/next navigation never re-centers. Centering is
 * computed from the time-grid header height plus {@link timeToOffset} rather than
 * the now-line element, so it works even on first paint before the line mounts.
 *
 * Event injection is the single integration point — `eventsByDay`/`eventsByHour`
 * are threaded straight into the two grids, which forward them to their cells.
 */
export function ScheduleCalendar({
  scope,
  anchor,
  today,
  onScopeChange,
  onPrev,
  onNext,
  onToday,
  onSelectSlot,
  eventsByDay,
  eventsByHour,
}: ScheduleCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
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
    if (scope === 'month') {
      region.scrollTo({ top: 0 })
      return
    }
    const header = region.querySelector('[data-time-grid-header]')
    const headerHeight = header ? header.getBoundingClientRect().height : 0
    const target = headerHeight + timeToOffset(new Date()) - region.clientHeight / 2
    region.scrollTo({ top: Math.max(0, target) })
  }, [scope, scrollSignal])

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <CalendarToolbar
        scope={scope}
        label={label}
        onPrev={onPrev}
        onNext={onNext}
        onToday={handleToday}
        onScopeChange={onScopeChange}
      />
      <div ref={scrollRef} className='min-h-0 flex-1 overflow-auto overscroll-none'>
        {grid.kind === 'month' ? (
          <MonthGrid
            grid={grid}
            onSelectDay={(date) => onSelectSlot(date)}
            eventsByDay={eventsByDay}
          />
        ) : (
          <TimeGrid
            days={grid.kind === 'week' ? grid.days : [grid.day]}
            hours={grid.hours}
            onSelectSlot={(date, time) => onSelectSlot(date, time)}
            eventsByHour={eventsByHour}
          />
        )}
      </div>
    </div>
  )
}
