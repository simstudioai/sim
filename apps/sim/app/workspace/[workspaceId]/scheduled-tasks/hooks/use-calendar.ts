'use client'

import { useCallback, useEffect, useState } from 'react'
import { isSameDay } from 'date-fns'
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
  selectSlot: (date: Date, time?: string) => void
  openCreate: () => void
  closeCreate: () => void
}

/**
 * Owns the calendar's ephemeral view state (scope, anchor, selected slot, and
 * create-modal open state). Pure UI state — `useState`, not a store. Opens on
 * the `week` scope. `today` is polled so the today highlight and current-time
 * column survive midnight without a remount; the poll only re-renders when the
 * day actually changes (the interval is resilient to device sleep, unlike a
 * one-shot timeout aimed at midnight).
 */
export function useCalendar(): UseCalendarReturn {
  const [today, setToday] = useState<Date>(() => new Date())
  const [scope, setScope] = useState<CalendarScope>('week')
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setToday((current) => (isSameDay(current, new Date()) ? current : new Date()))
    }, DAY_ROLLOVER_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const next = useCallback(() => setAnchor((current) => advanceAnchor(current, scope, 1)), [scope])
  const prev = useCallback(() => setAnchor((current) => advanceAnchor(current, scope, -1)), [scope])
  const goToday = useCallback(() => setAnchor(new Date()), [])

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
    selectSlot,
    openCreate,
    closeCreate,
  }
}
