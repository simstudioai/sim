import { create } from 'zustand'
import type { FilterState, LogLevel, TimeRange, TriggerType } from './types'

// Helper functions for URL synchronization
const getSearchParams = () => {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

const updateURL = (params: URLSearchParams) => {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  url.search = params.toString()
  window.history.replaceState({}, '', url)
}

const parseTimeRangeFromURL = (value: string | null): TimeRange => {
  switch (value) {
    case 'past-30-minutes':
      return 'Past 30 minutes'
    case 'past-hour':
      return 'Past hour'
    case 'past-24-hours':
      return 'Past 24 hours'
    default:
      return 'All time'
  }
}

const parseLogLevelFromURL = (value: string | null): LogLevel => {
  if (value === 'error' || value === 'info') return value
  return 'all'
}

const parseTriggerArrayFromURL = (value: string | null): TriggerType[] => {
  if (!value) return []
  return value
    .split(',')
    .filter((t): t is TriggerType => ['chat', 'api', 'webhook', 'manual', 'schedule'].includes(t))
}

const parseStringArrayFromURL = (value: string | null): string[] => {
  if (!value) return []
  return value.split(',').filter(Boolean)
}

const timeRangeToURL = (timeRange: TimeRange): string => {
  switch (timeRange) {
    case 'Past 30 minutes':
      return 'past-30-minutes'
    case 'Past hour':
      return 'past-hour'
    case 'Past 24 hours':
      return 'past-24-hours'
    default:
      return 'all-time'
  }
}

export const useFilterStore = create<FilterState>((set, get) => ({
  logs: [],
  workspaceId: '',
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
  _isInitializing: false, // Internal flag to prevent URL sync during initialization

  setLogs: (logs, append = false) => {
    if (append) {
      const currentLogs = [...get().logs]
      const newLogs = [...currentLogs, ...logs]
      set({ logs: newLogs })
    } else {
      set({ logs, loading: false })
    }
  },

  setWorkspaceId: (workspaceId) => set({ workspaceId }),

  setTimeRange: (timeRange) => {
    set({ timeRange })
    get().resetPagination()
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setLevel: (level) => {
    set({ level })
    get().resetPagination()
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setWorkflowIds: (workflowIds) => {
    set({ workflowIds })
    get().resetPagination()
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
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
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setFolderIds: (folderIds) => {
    set({ folderIds })
    get().resetPagination()
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
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
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery })
    get().resetPagination()
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setTriggers: (triggers: TriggerType[]) => {
    set({ triggers })
    get().resetPagination()
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
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
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setPage: (page) => set({ page }),

  setHasMore: (hasMore) => set({ hasMore }),

  setIsFetchingMore: (isFetchingMore) => set({ isFetchingMore }),

  resetPagination: () => set({ page: 1, hasMore: true }),

  // URL synchronization methods
  initializeFromURL: () => {
    // Set initialization flag to prevent URL sync during init
    set({ _isInitializing: true })

    const params = getSearchParams()

    const timeRange = parseTimeRangeFromURL(params.get('timeRange'))
    const level = parseLogLevelFromURL(params.get('level'))
    const workflowIds = parseStringArrayFromURL(params.get('workflowIds'))
    const folderIds = parseStringArrayFromURL(params.get('folderIds'))
    const triggers = parseTriggerArrayFromURL(params.get('triggers'))
    const searchQuery = params.get('search') || ''

    set({
      timeRange,
      level,
      workflowIds,
      folderIds,
      triggers,
      searchQuery,
      _isInitializing: false, // Clear the flag after initialization
    })

    // Ensure URL reflects the initialized state
    get().syncWithURL()
  },

  syncWithURL: () => {
    const { timeRange, level, workflowIds, folderIds, triggers, searchQuery } = get()
    const params = new URLSearchParams()

    // Only add non-default values to keep URL clean
    if (timeRange !== 'All time') {
      params.set('timeRange', timeRangeToURL(timeRange))
    }

    if (level !== 'all') {
      params.set('level', level)
    }

    if (workflowIds.length > 0) {
      params.set('workflowIds', workflowIds.join(','))
    }

    if (folderIds.length > 0) {
      params.set('folderIds', folderIds.join(','))
    }

    if (triggers.length > 0) {
      params.set('triggers', triggers.join(','))
    }

    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim())
    }

    updateURL(params)
  },

  // Build query parameters for server-side filtering
  buildQueryParams: (page: number, limit: number) => {
    const { workspaceId, timeRange, level, workflowIds, folderIds, searchQuery, triggers } = get()
    const params = new URLSearchParams()

    params.set('includeWorkflow', 'true')
    params.set('limit', limit.toString())
    params.set('offset', ((page - 1) * limit).toString())

    params.set('workspaceId', workspaceId)

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
