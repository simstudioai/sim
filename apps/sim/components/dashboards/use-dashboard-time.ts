'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { useIsFetching } from '@tanstack/react-query'
import { getBrowserTimezone } from '@/lib/core/utils/timezone'
import type { DashboardRange, DashboardTime } from '@/lib/dashboards/spec'
import {
  type DashboardTimeRange,
  dashboardRangeFromCalendar,
  parseDashboardCustomRange,
  relativeDashboardRange,
} from '@/lib/dashboards/time'
import { tableAnalyticsKeys } from '@/hooks/queries/table-analytics'
import { createDashboardCursorStore, type DashboardCursorStore } from '@/stores/dashboards/cursor'

/** How often a relative range advances its end to the present while the page is visible. */
const LIVE_TICK_MS = 60_000

export interface DashboardTimeState {
  range: DashboardRange | 'custom' | null
  from: string | null
  to: string | null
  zone: 'utc' | 'local'
}

interface UseDashboardTimeProps {
  state: DashboardTimeState
  setState: (update: Partial<DashboardTimeState>) => void
  /** The authored default; the viewer's selection in `state` wins over it. */
  time: DashboardTime | undefined
  workspaceId: string
  tableIds: ReadonlySet<string>
  /**
   * Refreshes every minute while true and the page is visible: relative ranges advance to the
   * present, fixed and zoomed ranges refetch in place.
   */
  live?: boolean
}

/**
 * Resolves the active time range and wires the range controls, zoom, refresh, and cursor sync.
 * The caller owns where the selection lives: the URL on the dashboard page, local state in an
 * embedded fence.
 */
export function useDashboardTime({
  state,
  setState,
  time,
  workspaceId,
  tableIds,
  live = false,
}: UseDashboardTimeProps) {
  const cursorStoreRef = useRef<DashboardCursorStore | null>(null)
  cursorStoreRef.current ??= createDashboardCursorStore()
  const cursorStore = cursorStoreRef.current
  const [now, setNow] = useState(() => Date.now())
  const [inputError, setInputError] = useState<string | null>(null)
  const queryFilter = {
    queryKey: tableAnalyticsKeys.queries(),
    predicate: (query: { queryKey: readonly unknown[] }) =>
      toRecord(query.queryKey[3]).workspaceId === workspaceId &&
      tableIds.has(String(query.queryKey[2])),
  }
  const isFetching = useIsFetching(queryFilter) > 0
  const timeZone = state.zone === 'local' ? getBrowserTimezone() : 'UTC'
  const fixed = typeof time === 'object' ? time : null
  const preset = typeof time === 'string' ? time : '7d'
  const period = state.range ?? (fixed ? 'custom' : preset)

  let range: DashboardTimeRange = relativeDashboardRange(period === 'custom' ? '7d' : period, now)
  let rangeError: string | null = null
  if (period === 'custom') {
    const custom = state.range === 'custom' ? { from: state.from ?? '', to: state.to ?? '' } : fixed
    try {
      if (!custom) throw new Error('Choose a custom range')
      range = parseDashboardCustomRange(custom.from, custom.to)
    } catch (error) {
      rangeError = getErrorMessage(error, 'Choose a custom range')
    }
  }

  /** Advancing `now` rolls relative ranges and re-keys fixed ones, refetching only this view. */
  const tick = useEffectEvent(() => {
    if (document.visibilityState === 'visible') setNow(Date.now())
  })
  /** A view that resumes after a pause catches up at once instead of on the next tick. */
  const catchUp = useEffectEvent(() => {
    if (Date.now() - now >= LIVE_TICK_MS) tick()
  })
  useEffect(() => {
    if (!live) return
    catchUp()
    const interval = setInterval(tick, LIVE_TICK_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [live])

  const onZoom = (selected: DashboardTimeRange) => {
    setInputError(null)
    setState({ range: 'custom', ...selected })
  }
  /** Returns to the authored range, re-anchored to the present. */
  const reset = () => {
    cursorStore.getState().clearCursor()
    setNow(Date.now())
    setState({ range: null, from: null, to: null })
  }

  return {
    range,
    now,
    rangeError,
    inputError,
    reset,
    interactions: { cursorStore, timeZone, onZoom },
    controls: {
      period,
      range,
      timeZone,
      zone: state.zone,
      isFetching,
      rangeError: rangeError !== null,
      onPeriodChange: (value: DashboardRange | 'custom') => {
        setInputError(null)
        cursorStore.getState().clearCursor()
        setNow(Date.now())
        setState({ range: value, from: null, to: null })
      },
      onCalendarChange: (from: string, to: string) => {
        try {
          const selected = dashboardRangeFromCalendar(from, to, timeZone)
          setInputError(null)
          setState({ range: 'custom', ...selected })
          return true
        } catch (error) {
          setInputError(getErrorMessage(error, 'Invalid range'))
          return false
        }
      },
      onRefresh: () => {
        setNow(Date.now())
        cursorStore.getState().clearCursor()
      },
      onZoneChange: (zone: 'utc' | 'local') => setState({ zone }),
    },
  }
}
