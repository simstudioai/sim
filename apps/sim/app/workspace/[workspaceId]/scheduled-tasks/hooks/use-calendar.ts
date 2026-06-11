'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  advanceAnchor,
  type CalendarScope,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'

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
  /** Stable "now" for the calendar's lifetime, shared by every view. */
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
 * create-modal open state). Pure UI state — `useState`, not a store. All
 * mutations are event-driven; there are no effects. Opens on the `week` scope.
 */
export function useCalendar(): UseCalendarReturn {
  const today = useMemo(() => new Date(), [])
  const [scope, setScope] = useState<CalendarScope>('week')
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

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
