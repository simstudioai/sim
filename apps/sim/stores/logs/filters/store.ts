import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { LogViewState } from '@/stores/logs/filters/types'

/**
 * Logs view store. Holds only non-URL view state (the logs/dashboard toggle).
 * All filter state is URL-backed via `useLogFilters` (nuqs).
 */
export const useFilterStore = create<LogViewState>()(
  devtools(
    (set) => ({
      viewMode: 'logs',
      setViewMode: (viewMode) => set({ viewMode }),
    }),
    { name: 'logs-view-store' }
  )
)
