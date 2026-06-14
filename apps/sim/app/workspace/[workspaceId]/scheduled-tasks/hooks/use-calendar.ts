'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isSameDay } from 'date-fns'
import { zonedClockDate } from '@/lib/core/utils/timezone'
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
 * Owns the calendar's ephemeral view state (scope, anchor, selected slot, and
 * create-modal open state). Pure UI state — `useState`, not a store. Opens on
 * the `week` scope. "Now" (the today highlight, the anchor's initial day) is
 * resolved in `timezone` — the viewer's effective zone — so the calendar's date
 * frame matches the zone tasks are scheduled in. `today` is polled so the today
 * highlight and current-time column survive midnight without a remount; the poll
 * only re-renders when the day actually changes (the interval is resilient to
 * device sleep, unlike a one-shot timeout aimed at midnight).
 */
export function useCalendar(timezone: string): UseCalendarReturn {
  const timezoneRef = useRef(timezone)
  const [today, setToday] = useState<Date>(() => zonedClockDate(new Date(), timezone))
  const [scope, setScope] = useState<CalendarScope>('week')
  const [anchor, setAnchor] = useState<Date>(() => zonedClockDate(new Date(), timezone))
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const todayRef = useRef(today)

  useEffect(() => {
    todayRef.current = today
  }, [today])

  /**
   * Re-sync to the effective zone's current day when `timezone` actually
   * changes — e.g. when `useTimezone()` resolves from the browser fallback to
   * the saved account zone after mount. The focused day follows only while it is
   * still on "today", so an in-progress navigation is preserved. Owning
   * `timezoneRef` here (instead of a separate sync effect) keeps the guard
   * honest: the ref still reflects the previous zone when this runs.
   */
  useEffect(() => {
    if (timezoneRef.current === timezone) return
    timezoneRef.current = timezone
    const now = zonedClockDate(new Date(), timezone)
    setAnchor((current) => (isSameDay(current, todayRef.current) ? now : current))
    setToday(now)
  }, [timezone])

  useEffect(() => {
    const id = setInterval(() => {
      const now = zonedClockDate(new Date(), timezoneRef.current)
      setToday((current) => (isSameDay(current, now) ? current : now))
    }, DAY_ROLLOVER_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const next = useCallback(() => setAnchor((current) => advanceAnchor(current, scope, 1)), [scope])
  const prev = useCallback(() => setAnchor((current) => advanceAnchor(current, scope, -1)), [scope])
  const goToday = useCallback(() => setAnchor(zonedClockDate(new Date(), timezoneRef.current)), [])
  const goToDate = useCallback((date: Date) => setAnchor(date), [])

  const openDay = useCallback((date: Date) => {
    setAnchor(date)
    setScope('day')
  }, [])

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
