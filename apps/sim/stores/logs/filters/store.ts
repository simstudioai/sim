import { create } from 'zustand'
import type { FilterState, LogLevel, TimeRange, TriggerType } from '@/stores/logs/filters/types'

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

const DEFAULT_TIME_RANGE: TimeRange = 'All time'

const parseTimeRangeFromURL = (value: string | null): TimeRange => {
  switch (value) {
    case 'all-time':
      return 'All time'
    case 'past-30-minutes':
      return 'Past 30 minutes'
    case 'past-hour':
      return 'Past hour'
    case 'past-6-hours':
      return 'Past 6 hours'
    case 'past-12-hours':
      return 'Past 12 hours'
    case 'past-24-hours':
      return 'Past 24 hours'
    case 'past-3-days':
      return 'Past 3 days'
    case 'past-7-days':
      return 'Past 7 days'
    case 'past-14-days':
      return 'Past 14 days'
    case 'past-30-days':
      return 'Past 30 days'
    default:
      return DEFAULT_TIME_RANGE
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
    case 'Past 6 hours':
      return 'past-6-hours'
    case 'Past 12 hours':
      return 'past-12-hours'
    case 'Past 24 hours':
      return 'past-24-hours'
    case 'Past 3 days':
      return 'past-3-days'
    case 'Past 7 days':
      return 'past-7-days'
    case 'Past 14 days':
      return 'past-14-days'
    case 'Past 30 days':
      return 'past-30-days'
    default:
      return 'all-time'
  }
}

export const useFilterStore = create<FilterState>((set, get) => ({
  workspaceId: '',
  viewMode: 'logs',
  timeRange: DEFAULT_TIME_RANGE,
  level: 'all',
  workflowIds: [],
  folderIds: [],
  searchQuery: '',
  triggers: [],
  _isInitializing: false, // Internal flag to prevent URL sync during initialization

  setWorkspaceId: (workspaceId) => set({ workspaceId }),

  setViewMode: (viewMode) => set({ viewMode }),

  setTimeRange: (timeRange) => {
    set({ timeRange })
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setLevel: (level) => {
    set({ level })
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setWorkflowIds: (workflowIds) => {
    set({ workflowIds })
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
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setFolderIds: (folderIds) => {
    set({ folderIds })
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
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery })
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  setTriggers: (triggers: TriggerType[]) => {
    set({ triggers })
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
    if (!get()._isInitializing) {
      get().syncWithURL()
    }
  },

  initializeFromURL: () => {
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

    get().syncWithURL()
  },

  syncWithURL: () => {
    const { timeRange, level, workflowIds, folderIds, triggers, searchQuery } = get()
    const params = new URLSearchParams()

    if (timeRange !== DEFAULT_TIME_RANGE) {
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
}))
