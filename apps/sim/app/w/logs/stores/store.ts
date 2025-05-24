import { create } from 'zustand'
import { FilterState } from './types'

export const useFilterStore = create<FilterState>((set, get) => ({
  logs: [],
  filteredLogs: [],
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  searchQuery: '',
  loading: true,
  error: null,
  page: 1,
  hasMore: true,
  isFetchingMore: false,

  setLogs: (logs, append = false) => {
    if (append) {
      const currentLogs = [...get().logs]
      const newLogs = [...currentLogs, ...logs]
      set({ logs: newLogs })
      get().applyFilters()
    } else {
      set({ logs, filteredLogs: logs, loading: false })
    }
  },

  setTimeRange: (timeRange) => {
    set({ timeRange })
    get().resetPagination()
    get().applyFilters()
  },

  setLevel: (level) => {
    set({ level })
    get().resetPagination()
    get().applyFilters()
  },

  setWorkflowIds: (workflowIds) => {
    set({ workflowIds })
    get().resetPagination()
    get().applyFilters()
  },

  toggleWorkflowId: (workflowId) => {
    const currentWorkflowIds = [...get().workflowIds]
    const index = currentWorkflowIds.indexOf(workflowId)

    if (index === -1) {
      currentWorkflowIds.push(workflowId)
    } else {
      currentWorkflowIds.splice(index, 1)
    }

    set({ workflowIds: currentWorkflowIds })
    get().resetPagination()
    get().applyFilters()
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery })
    get().resetPagination()
    get().applyFilters()
  },

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setPage: (page) => set({ page }),

  setHasMore: (hasMore) => set({ hasMore }),

  setIsFetchingMore: (isFetchingMore) => set({ isFetchingMore }),

  resetPagination: () => set({ page: 1, hasMore: true }),

  applyFilters: () => {
    const { logs, timeRange, level, workflowIds, searchQuery } = get()

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
    if (workflowIds.length > 0) {
      filtered = filtered.filter((log) => workflowIds.includes(log.workflowId))
    }

    // Apply search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(query) ||
          (log.executionId && log.executionId.toLowerCase().includes(query))
      )
    }

    set({ filteredLogs: filtered })
  },
}))
