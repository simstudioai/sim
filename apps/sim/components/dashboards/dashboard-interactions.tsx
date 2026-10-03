'use client'

import { createContext, useContext } from 'react'
import type { DashboardTimeRange } from '@/lib/dashboards/time'
import type { DashboardCursorStore } from '@/stores/dashboards/cursor'

interface DashboardInteractions {
  cursorStore: DashboardCursorStore
  timeZone: string
  onZoom: (range: DashboardTimeRange) => void
}
export const DashboardInteractionContext = createContext<DashboardInteractions | null>(null)

export function useDashboardInteractions() {
  const context = useContext(DashboardInteractionContext)
  if (!context) throw new Error('Dashboard interactions require a dashboard provider')
  return context
}
