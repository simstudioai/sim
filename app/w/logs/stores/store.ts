import { create } from 'zustand'
import { WorkflowLog } from './types'

export type TimeRange = 'Past 30 minutes' | 'Past hour' | 'Past 24 hours' | 'All time'
export type LogLevel = 'error' | 'info' | 'all'

interface FilterState {
  // Original logs from API
  logs: WorkflowLog[]
  // Filtered logs to display
  filteredLogs: WorkflowLog[]
  // Filter states
  timeRange: TimeRange
  level: LogLevel
  workflowId: string | null
  // Loading state
  loading: boolean
  error: string | null
  // Actions
  setLogs: (logs: WorkflowLog[]) => void
  setTimeRange: (timeRange: TimeRange) => void
  setLevel: (level: LogLevel) => void
  setWorkflowId: (workflowId: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  // Apply filters
  applyFilters: () => void
}

export const useFilterStore = create<FilterState>((set, get) => ({
  logs: [],
  filteredLogs: [],
  timeRange: 'All time',
  level: 'all',
  workflowId: null,
  loading: true,
  error: null,

  setLogs: (logs) => {
    set({ logs, filteredLogs: logs, loading: false })
  },

  setTimeRange: (timeRange) => {
    set({ timeRange })
    get().applyFilters()
  },

  setLevel: (level) => {
    set({ level })
    get().applyFilters()
  },

  setWorkflowId: (workflowId) => {
    set({ workflowId })
    get().applyFilters()
  },

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  applyFilters: () => {
    const { logs, timeRange, level, workflowId } = get()

    let filtered = [...logs]

    // Apply time range filter
    if (timeRange !== 'All time') {
      const now = new Date()
      let cutoffTime: Date

      switch (timeRange) {
        case 'Past 30 minutes':
          cutoffTime = new Date(now.getTime() - 30 * 60 * 1000)
          break
        case 'Past hour':
          cutoffTime = new Date(now.getTime() - 60 * 60 * 1000)
          break
        case 'Past 24 hours':
          cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          break
        default:
          cutoffTime = new Date(0) // Beginning of time
      }

      filtered = filtered.filter((log) => new Date(log.createdAt) >= cutoffTime)
    }

    // Apply level filter
    if (level !== 'all') {
      filtered = filtered.filter((log) => log.level.toLowerCase() === level)
    }

    // Apply workflow filter
    if (workflowId) {
      filtered = filtered.filter((log) => log.workflowId === workflowId)
    }

    set({ filteredLogs: filtered })
  },
}))
