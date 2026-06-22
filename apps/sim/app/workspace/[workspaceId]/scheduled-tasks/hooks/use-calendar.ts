'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isSameDay } from 'date-fns'
import { useQueryStates } from 'nuqs'
import { zonedClockDate } from '@/lib/core/utils/timezone'
import {
  calendarParsers,
  calendarUrlKeys,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/search-params'
import {
  advanceAnchor,
  type CalendarScope,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'

/** How often to check whether the calendar day has rolled over. */
const DAY_ROLLOVER_POLL_MS = 60_000

/** A clicked calendar position: a day, optionally narrowed to an hour slot. */
export interface CalendarSlot {
  date: Date
  /** `HH:mm` when a time slot was clicked; absent for a whole-day click. */
  time?: string
}

export interface UseCalendarReturn {
  scope: CalendarScope
  /** The focused day; week/month ranges derive from it. */
  anchor: Date
  /** The current calendar day, shared by every view; refreshes at midnight. */
  today: Date
  selectedSlot: CalendarSlot | null
  isCreateOpen: boolean
  setScope: (scope: CalendarScope) => void
  next: () => void
  prev: () => void
  goToday: () => void
  /** Jumps the view to an arbitrary day, keeping the current scope. */
  goToDate: (date: Date) => void
  /** Jumps to a day AND switches to the day scope (month-cell overflow drill-in). */
  openDay: (date: Date) => void
  selectSlot: (date: Date, time?: string) => void
  openCreate: () => void
  closeCreate: () => void
}

/**
 * Owns the calendar's view state. `scope` and `anchor` live in the URL (nuqs) so
 * the current view is shareable and survives reload / back-forward; the create
 * modal and selected slot stay local (ephemeral UI). Opens on the `week` scope.
 * "Now" (the today highlight, the default anchor) is resolved in `timezone` — the
 * viewer's effective zone — so the calendar's date frame matches the zone tasks
 * are scheduled in. The `anchor` param is date-only and nullable: a clean URL
 * means "today", derived per-timezone here, so navigating to today clears the
 * param. `today` is polled so the today highlight and current-time column survive
 * midnight without a remount; the poll only re-renders when the day actually
 * changes (the interval is resilient to device sleep, unlike a one-shot timeout
 * aimed at midnight).
 */
export function useCalendar(timezone: string): UseCalendarReturn {
  const timezoneRef = useRef(timezone)
  const [today, setToday] = useState<Date>(() => zonedClockDate(new Date(), timezone))
  const [{ scope, anchor: anchorParam }, setCalendarState] = useQueryStates(
    calendarParsers,
    calendarUrlKeys
  )
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const todayRef = useRef(today)

  /** A clean URL (no `anchor` param) means "today", resolved in the effective zone. */
  const anchor = anchorParam ?? today
  const anchorRef = useRef(anchor)

  useEffect(() => {
    todayRef.current = today
  }, [today])
  useEffect(() => {
    anchorRef.current = anchor
  }, [anchor])

  const setScope = useCallback(
    (next: CalendarScope) => {
      void setCalendarState({ scope: next })
    },
    [setCalendarState]
  )

  /**
   * Set the focused day. Writing `today` (the default anchor) as `null` keeps the
   * URL clean and preserves the "clean URL = today" invariant.
   */
  const setAnchorDate = useCallback(
    (date: Date) => {
      void setCalendarState({ anchor: isSameDay(date, todayRef.current) ? null : date })
    },
    [setCalendarState]
  )

  /**
   * Re-sync `today` to the effective zone's current day when `timezone` actually
   * changes — e.g. when `useTimezone()` resolves from the browser fallback to the
   * saved account zone after mount. When the URL holds an explicit anchor that
   * was on the previous "today", drop it so the view follows to the new today;
   * an in-progress navigation (anchor on another day) is preserved.
   */
  useEffect(() => {
    if (timezoneRef.current === timezone) return
    timezoneRef.current = timezone
    const now = zonedClockDate(new Date(), timezone)
    if (anchorRef.current && isSameDay(anchorRef.current, todayRef.current)) {
      void setCalendarState({ anchor: null })
    }
    setToday(now)
  }, [timezone, setCalendarState])

  useEffect(() => {
    const id = setInterval(() => {
      const now = zonedClockDate(new Date(), timezoneRef.current)
      setToday((current) => (isSameDay(current, now) ? current : now))
    }, DAY_ROLLOVER_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const next = useCallback(
    () => setAnchorDate(advanceAnchor(anchorRef.current, scope, 1)),
    [scope, setAnchorDate]
  )
  const prev = useCallback(
    () => setAnchorDate(advanceAnchor(anchorRef.current, scope, -1)),
    [scope, setAnchorDate]
  )
  const goToday = useCallback(
    () => setAnchorDate(zonedClockDate(new Date(), timezoneRef.current)),
    [setAnchorDate]
  )
  const goToDate = useCallback((date: Date) => setAnchorDate(date), [setAnchorDate])

  const openDay = useCallback(
    (date: Date) => {
      void setCalendarState({
        anchor: isSameDay(date, todayRef.current) ? null : date,
        scope: 'day',
      })
    },
    [setCalendarState]
  )

  const selectSlot = useCallback((date: Date, time?: string) => {
    setSelectedSlot({ date, time })
    setIsCreateOpen(true)
  }, [])

  const openCreate = useCallback(() => {
    setSelectedSlot(null)
    setIsCreateOpen(true)
  }, [])

  const closeCreate = useCallback(() => {
    setIsCreateOpen(false)
    setSelectedSlot(null)
  }, [])

  return {
    scope,
    anchor,
    today,
    selectedSlot,
    isCreateOpen,
    setScope,
    next,
    prev,
    goToday,
    goToDate,
    openDay,
    selectSlot,
    openCreate,
    closeCreate,
  }
}
