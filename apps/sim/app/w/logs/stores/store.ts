import { create } from 'zustand'
import type { FilterState, TriggerType } from './types'

export const useFilterStore = create<FilterState>((set, get) => ({
  logs: [],
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  searchQuery: '',
  triggers: [],
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
    } else {
      set({ logs, loading: false })
    }
  },

  setTimeRange: (timeRange) => {
    set({ timeRange })
    get().resetPagination()
  },

  setLevel: (level) => {
    set({ level })
    get().resetPagination()
  },

  setWorkflowIds: (workflowIds) => {
    set({ workflowIds })
    get().resetPagination()
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
  },

  setFolderIds: (folderIds) => {
    set({ folderIds })
    get().resetPagination()
  },

  toggleFolderId: (folderId) => {
    const currentFolderIds = [...get().folderIds]
    const index = currentFolderIds.indexOf(folderId)

    if (index === -1) {
      currentFolderIds.push(folderId)
    } else {
      currentFolderIds.splice(index, 1)
    }

    set({ folderIds: currentFolderIds })
    get().resetPagination()
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery })
    get().resetPagination()
  },

  setTriggers: (triggers: TriggerType[]) => {
    set({ triggers })
    get().resetPagination()
  },

  toggleTrigger: (trigger: TriggerType) => {
    const currentTriggers = [...get().triggers]
    const index = currentTriggers.indexOf(trigger)

    if (index === -1) {
      currentTriggers.push(trigger)
    } else {
      currentTriggers.splice(index, 1)
    }

    set({ triggers: currentTriggers })
    get().resetPagination()
  },

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setPage: (page) => set({ page }),

  setHasMore: (hasMore) => set({ hasMore }),

  setIsFetchingMore: (isFetchingMore) => set({ isFetchingMore }),

  resetPagination: () => set({ page: 1, hasMore: true }),

  // Build query parameters for server-side filtering
  buildQueryParams: (page: number, limit: number) => {
    const { timeRange, level, workflowIds, folderIds, searchQuery, triggers } = get()
    const params = new URLSearchParams()

    params.set('includeWorkflow', 'true')
    params.set('limit', limit.toString())
    params.set('offset', ((page - 1) * limit).toString())

    // Add level filter
    if (level !== 'all') {
      params.set('level', level)
    }

    // Add trigger filter
    if (triggers.length > 0) {
      params.set('triggers', triggers.join(','))
    }

    // Add workflow filter
    if (workflowIds.length > 0) {
      params.set('workflowIds', workflowIds.join(','))
    }

    // Add folder filter
    if (folderIds.length > 0) {
      params.set('folderIds', folderIds.join(','))
    }

    // Add time range filter
    if (timeRange !== 'All time') {
      const now = new Date()
      let startDate: Date

      switch (timeRange) {
        case 'Past 30 minutes':
          startDate = new Date(now.getTime() - 30 * 60 * 1000)
          break
        case 'Past hour':
          startDate = new Date(now.getTime() - 60 * 60 * 1000)
          break
        case 'Past 24 hours':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          break
        default:
          startDate = new Date(0)
      }

      params.set('startDate', startDate.toISOString())
    }

    // Add search filter
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim())
    }

    return params.toString()
  },
}))
