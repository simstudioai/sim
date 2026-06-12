'use client'

import { createContext, useContext } from 'react'

/**
 * Selection mode for a segment click: plain click, cmd/ctrl+click, or shift+click.
 */
export type SegmentSelectionMode = 'single' | 'toggle' | 'range'

export interface DashboardSegmentsContextValue {
  /** Selected segment indices keyed by workflow id. */
  selectedSegments: Record<string, number[]>
  /** Handles a segment click for selecting time segments. */
  onSegmentClick: (
    workflowId: string,
    segmentIndex: number,
    timestamp: string,
    mode: SegmentSelectionMode
  ) => void
  /** Duration of a single segment in milliseconds. */
  segmentDurationMs: number
}

/**
 * Feature-local context for dashboard segment selection state, provided by
 * the dashboard and consumed by StatusBar without threading props through
 * intermediate components.
 */
export const DashboardSegmentsContext = createContext<DashboardSegmentsContextValue | null>(null)

/**
 * Returns the dashboard segment selection context.
 * @throws Error when used outside DashboardSegmentsContext.Provider
 */
export function useDashboardSegments(): DashboardSegmentsContextValue {
  const context = useContext(DashboardSegmentsContext)
  if (!context) {
    throw new Error('useDashboardSegments must be used within DashboardSegmentsContext.Provider')
  }
  return context
}
