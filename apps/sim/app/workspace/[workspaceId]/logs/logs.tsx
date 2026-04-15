'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  Bell,
  Button,
  Combobox,
  type ComboboxOption,
  Download,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Library,
  Loader,
} from '@/components/emcn'
import { DatePicker } from '@/components/emcn/components/date-picker/date-picker'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { cn } from '@/lib/core/utils/cn'
import { formatDuration } from '@/lib/core/utils/formatting'
import {
  getEndDateFromTimeRange,
  getStartDateFromTimeRange,
  hasActiveFilters,
} from '@/lib/logs/filters'
import { getTriggerOptions } from '@/lib/logs/get-trigger-options'
import { type ParsedFilter, parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import {
  type FolderData,
  SearchSuggestions,
  type TriggerData,
  type WorkflowData,
} from '@/lib/logs/search-suggestions'
import { workflowBorderColor } from '@/lib/workspaces/colors'
import type {
  FilterTag,
  HeaderAction,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  ResourceHeader,
  ResourceOptionsBar,
  ResourceTable,
} from '@/app/workspace/[workspaceId]/components'
import { useSearchState } from '@/app/workspace/[workspaceId]/logs/hooks/use-search-state'
import type { Suggestion } from '@/app/workspace/[workspaceId]/logs/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks/registry'
import { useFolderMap, useFolders } from '@/hooks/queries/folders'
import {
  prefetchLogDetail,
  useCancelExecution,
  useDashboardStats,
  useLogDetail,
  useLogsList,
} from '@/hooks/queries/logs'
import { useWorkflowMap, useWorkflows } from '@/hooks/queries/workflows'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'
import {
  Dashboard,
  ExecutionSnapshot,
  LogDetails,
  LogRowContextMenu,
  NotificationSettings,
} from './components'
import {
  DELETED_WORKFLOW_COLOR,
  DELETED_WORKFLOW_LABEL,
  formatDate,
  getDisplayStatus,
  type LogStatus,
  parseDuration,
  STATUS_CONFIG,
  StatusBadge,
  TriggerBadge,
} from './utils'

const LOGS_PER_PAGE = 50 as const
const REFRESH_SPINNER_DURATION_MS = 1000 as const

const LOG_COLUMNS: ResourceColumn[] = [
  { id: 'workflow', header: 'Workflow' },
  { id: 'date', header: 'Date' },
  { id: 'status', header: 'Status' },
  { id: 'cost', header: 'Cost' },
  { id: 'trigger', header: 'Trigger' },
  { id: 'duration', header: 'Duration' },
]

interface LogSelectionState {
  selectedLogId: string | null
  isSidebarOpen: boolean
}

type LogSelectionAction =
  | { type: 'TOGGLE_LOG'; logId: string }
  | { type: 'SELECT_LOG'; logId: string }
  | { type: 'CLOSE_SIDEBAR' }
  | { type: 'TOGGLE_SIDEBAR' }

function logSelectionReducer(
  state: LogSelectionState,
  action: LogSelectionAction
): LogSelectionState {
  switch (action.type) {
    case 'TOGGLE_LOG':
      if (state.selectedLogId === action.logId && state.isSidebarOpen) {
        return { selectedLogId: null, isSidebarOpen: false }
      }
      return { selectedLogId: action.logId, isSidebarOpen: true }
    case 'SELECT_LOG':
      return { ...state, selectedLogId: action.logId }
    case 'CLOSE_SIDEBAR':
      return { selectedLogId: null, isSidebarOpen: false }
    case 'TOGGLE_SIDEBAR':
      return state.selectedLogId ? { ...state, isSidebarOpen: !state.isSidebarOpen } : state
    default:
      return state
  }
}

const TIME_RANGE_OPTIONS: ComboboxOption[] = [
  { value: 'All time', label: 'All time' },
  { value: 'Past 30 minutes', label: 'Past 30 minutes' },
  { value: 'Past hour', label: 'Past hour' },
  { value: 'Past 6 hours', label: 'Past 6 hours' },
  { value: 'Past 12 hours', label: 'Past 12 hours' },
  { value: 'Past 24 hours', label: 'Past 24 hours' },
  { value: 'Past 3 days', label: 'Past 3 days' },
  { value: 'Past 7 days', label: 'Past 7 days' },
  { value: 'Past 14 days', label: 'Past 14 days' },
  { value: 'Past 30 days', label: 'Past 30 days' },
  { value: 'Custom range', label: 'Custom range' },
] as const

const colorIconCache = new Map<string, React.ComponentType<{ className?: string }>>()

function getColorIcon(
  color: string,
  withRing = false
): React.ComponentType<{ className?: string }> {
  const cacheKey = withRing ? `${color}-ring` : color
  const cached = colorIconCache.get(cacheKey)
  if (cached) return cached

  const ColorIcon = ({ className }: { className?: string }) => (
    <div
      className={cn(className, 'flex-shrink-0 rounded-[3px]', withRing && 'border-[1.5px]')}
      style={{
        backgroundColor: color,
        width: 10,
        height: 10,
        ...(withRing && {
          borderColor: workflowBorderColor(color),
          backgroundClip: 'padding-box' as const,
        }),
      }}
    />
  )
  ColorIcon.displayName = `ColorIcon(${color}${withRing ? '-ring' : ''})`
  colorIconCache.set(cacheKey, ColorIcon)
  return ColorIcon
}

function getTriggerIcon(
  triggerType: string
): React.ComponentType<{ className?: string }> | undefined {
  if ((CORE_TRIGGER_TYPES as readonly string[]).includes(triggerType)) return undefined
  const block = getBlock(triggerType)
  if (!block?.icon) return undefined
  const BlockIcon = block.icon
  const TriggerIcon = ({ className }: { className?: string }) => (
    <BlockIcon className={cn(className, 'flex-shrink-0')} style={{ width: 12, height: 12 }} />
  )
  TriggerIcon.displayName = `TriggerIcon(${triggerType})`
  return TriggerIcon
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[date.getMonth()]} ${date.getDate()}`
}

/**
 * Logs page component displaying workflow execution history.
 * Supports filtering, search, live updates, and detailed log inspection.
 * @returns The logs page view with table and sidebar details
 */
export default function Logs() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    setWorkspaceId,
    initializeFromURL,
    timeRange,
    startDate,
    endDate,
    level,
    workflowIds,
    folderIds,
    setWorkflowIds,
    setSearchQuery: setStoreSearchQuery,
    triggers,
    viewMode,
    setViewMode,
    resetFilters,
    setLevel,
    setFolderIds,
    setTriggers,
    setTimeRange,
    setDateRange,
    clearDateRange,
  } = useFilterStore(
    useShallow((s) => ({
      setWorkspaceId: s.setWorkspaceId,
      initializeFromURL: s.initializeFromURL,
      timeRange: s.timeRange,
      startDate: s.startDate,
      endDate: s.endDate,
      level: s.level,
      workflowIds: s.workflowIds,
      folderIds: s.folderIds,
      setWorkflowIds: s.setWorkflowIds,
      setSearchQuery: s.setSearchQuery,
      triggers: s.triggers,
      viewMode: s.viewMode,
      setViewMode: s.setViewMode,
      resetFilters: s.resetFilters,
      setLevel: s.setLevel,
      setFolderIds: s.setFolderIds,
      setTriggers: s.setTriggers,
      setTimeRange: s.setTimeRange,
      setDateRange: s.setDateRange,
      clearDateRange: s.clearDateRange,
    }))
  )

  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId, setWorkspaceId])

  const [{ selectedLogId, isSidebarOpen }, dispatch] = useReducer(logSelectionReducer, {
    selectedLogId: null,
    isSidebarOpen: false,
  })
  const isInitialized = useRef<boolean>(false)
  const pendingExecutionIdRef = useRef<string | null | undefined>(undefined)
  if (pendingExecutionIdRef.current === undefined) {
    pendingExecutionIdRef.current =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('executionId')
        : null
  }

  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('search') ?? ''
  })
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const isLive = true
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const refreshTimersRef = useRef(new Set<number>())
  const logsRef = useRef<WorkflowLog[]>([])
  const selectedLogIndexRef = useRef(-1)
  const selectedLogIdRef = useRef<string | null>(null)
  const logsRefetchRef = useRef<() => void>(() => {})
  const activeLogRefetchRef = useRef<() => void>(() => {})
  const logsQueryRef = useRef({ isFetching: false, hasNextPage: false, fetchNextPage: () => {} })
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const [activeSort, setActiveSort] = useState<{
    column: string
    direction: 'asc' | 'desc'
  } | null>(null)
  const userPermissions = useUserPermissionsContext()

  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [contextMenuLog, setContextMenuLog] = useState<WorkflowLog | null>(null)

  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewLogId, setPreviewLogId] = useState<string | null>(null)

  const activeLogId = isPreviewOpen ? previewLogId : selectedLogId
  const queryClient = useQueryClient()

  const detailRefetchInterval = useCallback(
    (query: { state: { data?: WorkflowLog } }) => {
      if (!isLive) return false
      const status = query.state.data?.status
      return status === 'running' || status === 'pending' ? 3000 : false
    },
    [isLive]
  )

  const activeLogQuery = useLogDetail(activeLogId ?? undefined, {
    refetchInterval: detailRefetchInterval,
  })

  const logFilters = useMemo(
    () => ({
      timeRange,
      startDate,
      endDate,
      level,
      workflowIds,
      folderIds,
      triggers,
      searchQuery: debouncedSearchQuery,
      limit: LOGS_PER_PAGE,
    }),
    [timeRange, startDate, endDate, level, workflowIds, folderIds, triggers, debouncedSearchQuery]
  )

  const logsQuery = useLogsList(workspaceId, logFilters, {
    enabled: Boolean(workspaceId) && isInitialized.current,
    refetchInterval: isLive ? 3000 : false,
  })

  const dashboardFilters = useMemo(
    () => ({
      timeRange,
      startDate,
      endDate,
      level,
      workflowIds,
      folderIds,
      triggers,
      searchQuery: debouncedSearchQuery,
    }),
    [timeRange, startDate, endDate, level, workflowIds, folderIds, triggers, debouncedSearchQuery]
  )

  const dashboardStatsQuery = useDashboardStats(workspaceId, dashboardFilters, {
    enabled: Boolean(workspaceId) && isInitialized.current,
    refetchInterval: isLive ? 3000 : false,
  })

  const logs = useMemo(() => {
    if (!logsQuery.data?.pages) return []
    return logsQuery.data.pages.flatMap((page) => page.logs)
  }, [logsQuery.data?.pages])

  const sortedLogs = useMemo(() => {
    if (!activeSort) return logs

    const { column, direction } = activeSort
    return [...logs].sort((a, b) => {
      let cmp = 0
      switch (column) {
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'duration': {
          const aDuration = parseDuration({ duration: a.duration ?? undefined }) ?? -1
          const bDuration = parseDuration({ duration: b.duration ?? undefined }) ?? -1
          cmp = aDuration - bDuration
          break
        }
        case 'cost': {
          const aCost = typeof a.cost?.total === 'number' ? a.cost.total : -1
          const bCost = typeof b.cost?.total === 'number' ? b.cost.total : -1
          cmp = aCost - bCost
          break
        }
        case 'status':
          cmp = (a.status ?? '').localeCompare(b.status ?? '')
          break
        default:
          break
      }
      return direction === 'asc' ? cmp : -cmp
    })
  }, [logs, activeSort])

  const selectedLogIndex = useMemo(
    () => (selectedLogId ? sortedLogs.findIndex((l) => l.id === selectedLogId) : -1),
    [sortedLogs, selectedLogId]
  )
  const selectedLogFromList = selectedLogIndex >= 0 ? sortedLogs[selectedLogIndex] : null

  const selectedLog = useMemo(() => {
    if (!selectedLogFromList) return null
    if (!activeLogQuery.data || isPreviewOpen || activeLogQuery.isPlaceholderData)
      return selectedLogFromList
    return { ...selectedLogFromList, ...activeLogQuery.data }
  }, [selectedLogFromList, activeLogQuery.data, activeLogQuery.isPlaceholderData, isPreviewOpen])

  const handleLogHover = useCallback(
    (rowId: string) => {
      prefetchLogDetail(queryClient, rowId)
    },
    [queryClient]
  )

  useFolders(workspaceId)

  logsRef.current = sortedLogs
  selectedLogIndexRef.current = selectedLogIndex
  selectedLogIdRef.current = selectedLogId
  logsRefetchRef.current = logsQuery.refetch
  activeLogRefetchRef.current = activeLogQuery.refetch
  logsQueryRef.current = {
    isFetching: logsQuery.isFetching,
    hasNextPage: logsQuery.hasNextPage ?? false,
    fetchNextPage: logsQuery.fetchNextPage,
  }

  useEffect(() => {
    if (!pendingExecutionIdRef.current) return
    const targetExecutionId = pendingExecutionIdRef.current
    const found = sortedLogs.find((l) => l.executionId === targetExecutionId)
    if (found) {
      pendingExecutionIdRef.current = null
      dispatch({ type: 'TOGGLE_LOG', logId: found.id })
    } else if (!logsQuery.hasNextPage && logsQuery.status === 'success') {
      pendingExecutionIdRef.current = null
    } else if (!logsQuery.isFetching && logsQuery.status === 'success') {
      logsQueryRef.current.fetchNextPage()
    }
  }, [sortedLogs, logsQuery.hasNextPage, logsQuery.isFetching, logsQuery.status])

  useEffect(() => {
    const timers = refreshTimersRef.current
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
    }
  }, [])

  useEffect(() => {
    if (isInitialized.current) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, setStoreSearchQuery])

  const handleLogClick = useCallback((rowId: string) => {
    dispatch({ type: 'TOGGLE_LOG', logId: rowId })
  }, [])

  const handleNavigateNext = useCallback(() => {
    const idx = selectedLogIndexRef.current
    const currentLogs = logsRef.current
    if (idx < currentLogs.length - 1) {
      dispatch({ type: 'SELECT_LOG', logId: currentLogs[idx + 1].id })
    }
  }, [])

  const handleNavigatePrev = useCallback(() => {
    const idx = selectedLogIndexRef.current
    if (idx > 0) {
      dispatch({ type: 'SELECT_LOG', logId: logsRef.current[idx - 1].id })
    }
  }, [])

  const handleCloseSidebar = useCallback(() => {
    dispatch({ type: 'CLOSE_SIDEBAR' })
  }, [])

  const handleLogContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      e.preventDefault()
      const log = sortedLogs.find((l) => l.id === rowId) ?? null
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setContextMenuLog(log)
      setContextMenuOpen(true)
    },
    [sortedLogs]
  )

  const handleCopyExecutionId = useCallback(() => {
    if (contextMenuLog?.executionId) {
      navigator.clipboard.writeText(contextMenuLog.executionId).catch(() => {})
    }
  }, [contextMenuLog])

  const handleCopyLink = useCallback(() => {
    if (contextMenuLog?.executionId) {
      const url = `${window.location.origin}/workspace/${workspaceId}/logs?executionId=${contextMenuLog.executionId}`
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }, [contextMenuLog, workspaceId])

  const handleOpenWorkflow = useCallback(() => {
    const wfId = contextMenuLog?.workflow?.id || contextMenuLog?.workflowId
    if (wfId) {
      window.open(`/workspace/${workspaceId}/w/${wfId}`, '_blank')
    }
  }, [contextMenuLog, workspaceId])

  const handleToggleWorkflowFilter = useCallback(() => {
    const wfId = contextMenuLog?.workflow?.id || contextMenuLog?.workflowId
    if (!wfId) return

    if (workflowIds.length === 1 && workflowIds[0] === wfId) {
      setWorkflowIds([])
    } else {
      setWorkflowIds([wfId])
    }
  }, [contextMenuLog, workflowIds, setWorkflowIds])

  const handleClearAllFilters = useCallback(() => {
    resetFilters()
    setSearchQuery('')
  }, [resetFilters, setSearchQuery])

  const handleOpenPreview = useCallback(() => {
    if (contextMenuLog?.id) {
      setPreviewLogId(contextMenuLog.id)
      setIsPreviewOpen(true)
    }
  }, [contextMenuLog])

  const cancelExecution = useCancelExecution()

  const handleCancelExecution = useCallback(() => {
    const workflowId = contextMenuLog?.workflow?.id || contextMenuLog?.workflowId
    const executionId = contextMenuLog?.executionId
    if (workflowId && executionId) {
      cancelExecution.mutate({ workflowId, executionId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenuLog])

  const contextMenuWorkflowId = contextMenuLog?.workflow?.id || contextMenuLog?.workflowId
  const isFilteredByThisWorkflow = Boolean(
    contextMenuWorkflowId && workflowIds.length === 1 && workflowIds[0] === contextMenuWorkflowId
  )

  const filtersActive = hasActiveFilters({
    timeRange,
    level,
    workflowIds,
    folderIds,
    triggers,
    searchQuery: debouncedSearchQuery,
  })

  useEffect(() => {
    if (!selectedLogId) return
    const row = document.querySelector(`[data-row-id="${selectedLogId}"]`) as HTMLElement | null
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedLogId, selectedLogIndex])

  const effectiveSidebarOpen = isSidebarOpen && selectedLogIndex !== -1

  const handleRefresh = useCallback(() => {
    setIsVisuallyRefreshing(true)
    const timerId = window.setTimeout(() => {
      setIsVisuallyRefreshing(false)
      refreshTimersRef.current.delete(timerId)
    }, REFRESH_SPINNER_DURATION_MS)
    refreshTimersRef.current.add(timerId)
    logsRefetchRef.current()
    if (selectedLogIdRef.current) {
      activeLogRefetchRef.current()
    }
  }, [])

  const prevIsFetchingRef = useRef(logsQuery.isFetching)
  useEffect(() => {
    const wasFetching = prevIsFetchingRef.current
    const isFetching = logsQuery.isFetching
    prevIsFetchingRef.current = isFetching

    if (isLive && !wasFetching && isFetching) {
      setIsVisuallyRefreshing(true)
      const timerId = window.setTimeout(() => {
        setIsVisuallyRefreshing(false)
        refreshTimersRef.current.delete(timerId)
      }, REFRESH_SPINNER_DURATION_MS)
      refreshTimersRef.current.add(timerId)
    }
  }, [logsQuery.isFetching, isLive])

  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('workspaceId', workspaceId)
      if (level !== 'all') params.set('level', level)
      if (triggers.length > 0) params.set('triggers', triggers.join(','))
      if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
      if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))

      const computedStartDate = getStartDateFromTimeRange(timeRange, startDate)
      if (computedStartDate) {
        params.set('startDate', computedStartDate.toISOString())
      }

      const computedEndDate = getEndDateFromTimeRange(timeRange, endDate)
      if (computedEndDate) {
        params.set('endDate', computedEndDate.toISOString())
      }

      const parsed = parseQuery(debouncedSearchQuery)
      const extra = queryToApiParams(parsed)
      Object.entries(extra).forEach(([k, v]) => params.set(k, v))

      const url = `/api/logs/export?${params.toString()}`
      const a = document.createElement('a')
      a.href = url
      a.download = 'logs_export.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setIsExporting(false)
    }
  }, [
    workspaceId,
    level,
    triggers,
    workflowIds,
    folderIds,
    timeRange,
    startDate,
    endDate,
    debouncedSearchQuery,
  ])

  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true
      initializeFromURL()
    }
  }, [initializeFromURL])

  useEffect(() => {
    const handlePopState = () => {
      initializeFromURL()
      const params = new URLSearchParams(window.location.search)
      setSearchQuery(params.get('search') || '')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [initializeFromURL])

  const loadMoreLogs = useCallback(() => {
    if (activeSort) return
    const { isFetching, hasNextPage, fetchNextPage } = logsQueryRef.current
    if (!isFetching && hasNextPage) {
      fetchNextPage()
    }
  }, [activeSort])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const currentLogs = logsRef.current
      const currentIndex = selectedLogIndexRef.current
      if (currentLogs.length === 0) return

      if (currentIndex === -1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        dispatch({ type: 'SELECT_LOG', logId: currentLogs[0].id })
        return
      }

      if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && currentIndex > 0) {
        e.preventDefault()
        handleNavigatePrev()
      }

      if (
        e.key === 'ArrowDown' &&
        !e.metaKey &&
        !e.ctrlKey &&
        currentIndex < currentLogs.length - 1
      ) {
        e.preventDefault()
        handleNavigateNext()
      }

      if (e.key === 'Enter' && selectedLogIdRef.current) {
        e.preventDefault()
        dispatch({ type: 'TOGGLE_SIDEBAR' })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNavigateNext, handleNavigatePrev])

  const handleCloseContextMenu = useCallback(() => setContextMenuOpen(false), [])
  const handleOpenNotificationSettings = useCallback(() => setIsNotificationSettingsOpen(true), [])
  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false)
    setPreviewLogId(null)
  }, [])

  const isDashboardView = viewMode === 'dashboard'

  const rows: ResourceRow[] = useMemo(
    () =>
      sortedLogs.map((log) => {
        const formattedDate = formatDate(log.createdAt)
        const displayStatus = getDisplayStatus(log.status)
        const isMothershipJob = log.trigger === 'mothership'
        const isDeletedWorkflow = !isMothershipJob && !log.workflow?.id && !log.workflowId
        const workflowName = isMothershipJob
          ? log.jobTitle || 'Untitled Job'
          : isDeletedWorkflow
            ? DELETED_WORKFLOW_LABEL
            : log.workflow?.name || 'Unknown'
        const workflowColor = isMothershipJob
          ? '#ec4899'
          : isDeletedWorkflow
            ? DELETED_WORKFLOW_COLOR
            : log.workflow?.color

        const durationMs = parseDuration({ duration: log.duration ?? undefined })
        const durationText =
          durationMs != null ? (formatDuration(durationMs, { precision: 2 }) ?? '—') : '—'

        const costCredits =
          typeof log.cost?.total === 'number' ? dollarsToCredits(log.cost.total) : null
        const costText =
          costCredits !== null
            ? `${costCredits.toLocaleString()} ${costCredits === 1 ? 'credit' : 'credits'}`
            : '—'

        return {
          id: log.id,
          cells: {
            workflow: {
              icon: workflowColor ? (
                <div
                  className='h-[10px] w-[10px] rounded-[3px] border-[1.5px]'
                  style={{
                    backgroundColor: workflowColor,
                    borderColor: workflowBorderColor(workflowColor),
                    backgroundClip: 'padding-box',
                  }}
                />
              ) : undefined,
              label: workflowName,
            },
            date: { label: `${formattedDate.compactDate} ${formattedDate.compactTime}` },
            status: { content: <StatusBadge status={displayStatus} /> },
            cost: { label: costText },
            trigger: { content: <TriggerBadge trigger={log.trigger || 'manual'} /> },
            duration: { label: durationText },
          },
        }
      }),
    [sortedLogs]
  )

  const sidebarOverlay = useMemo(
    () => (
      <LogDetails
        log={selectedLog}
        isOpen={effectiveSidebarOpen}
        onClose={handleCloseSidebar}
        onNavigateNext={handleNavigateNext}
        onNavigatePrev={handleNavigatePrev}
        hasNext={selectedLogIndex < sortedLogs.length - 1}
        hasPrev={selectedLogIndex > 0}
      />
    ),
    [
      selectedLog,
      effectiveSidebarOpen,
      handleCloseSidebar,
      handleNavigateNext,
      handleNavigatePrev,
      selectedLogIndex,
      sortedLogs.length,
    ]
  )

  const { data: allWorkflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)

  const filterTags = useMemo<FilterTag[]>(() => {
    const tags: FilterTag[] = []

    if (level && level !== 'all') {
      const statuses = level.split(',').filter(Boolean)
      const labels = statuses.map((s) => STATUS_CONFIG[s as LogStatus]?.label ?? s)
      tags.push({
        label: `Status: ${labels.join(', ')}`,
        onRemove: () => setLevel('all'),
      })
    }

    if (workflowIds.length > 0) {
      const names = workflowIds.map((id) => allWorkflows[id]?.name ?? id.slice(0, 8))
      tags.push({
        label: `Workflow: ${names.join(', ')}`,
        onRemove: () => setWorkflowIds([]),
      })
    }

    if (folderIds.length > 0) {
      const names = folderIds.map((id) => folders[id]?.name ?? id.slice(0, 8))
      tags.push({
        label: `Folder: ${names.join(', ')}`,
        onRemove: () => setFolderIds([]),
      })
    }

    if (triggers.length > 0) {
      tags.push({
        label: `Trigger: ${triggers.join(', ')}`,
        onRemove: () => setTriggers([]),
      })
    }

    if (timeRange !== 'All time') {
      tags.push({
        label:
          timeRange === 'Custom range' && startDate && endDate
            ? `${startDate} – ${endDate}`
            : timeRange,
        onRemove: () => {
          clearDateRange()
          setTimeRange('All time')
        },
      })
    }

    return tags
  }, [
    level,
    setLevel,
    workflowIds,
    setWorkflowIds,
    allWorkflows,
    folderIds,
    setFolderIds,
    folders,
    triggers,
    setTriggers,
    timeRange,
    startDate,
    endDate,
    clearDateRange,
    setTimeRange,
  ])

  const workflowsData = useMemo<WorkflowData[]>(
    () =>
      Object.values(allWorkflows).map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
      })),
    [allWorkflows]
  )
  const foldersData = useMemo<FolderData[]>(
    () => Object.values(folders).map((f) => ({ id: f.id, name: f.name })),
    [folders]
  )
  const triggersData = useMemo<TriggerData[]>(
    () => getTriggerOptions().map((t) => ({ value: t.value, label: t.label, color: t.color })),
    []
  )
  const suggestionEngine = useMemo(
    () => new SearchSuggestions(workflowsData, foldersData, triggersData),
    [workflowsData, foldersData, triggersData]
  )

  const handleFiltersChange = useCallback((filters: ParsedFilter[], textSearch: string) => {
    const filterStrings = filters.map(
      (f) => `${f.field}:${f.operator !== '=' ? f.operator : ''}${f.originalValue}`
    )
    const fullQuery = [...filterStrings, textSearch].filter(Boolean).join(' ')
    setSearchQuery(fullQuery)
  }, [])

  const {
    appliedFilters,
    currentInput,
    textSearch,
    isOpen: isSuggestionsOpen,
    suggestions,
    sections,
    highlightedIndex,
    highlightedBadgeIndex,
    inputRef: searchInputRef,
    dropdownRef: searchDropdownRef,
    handleInputChange: handleSearchInputChange,
    handleSuggestionSelect,
    handleKeyDown: handleSearchKeyDown,
    handleFocus: handleSearchFocus,
    handleBlur: handleSearchBlur,
    removeBadge,
    clearAll: clearSearch,
    setHighlightedIndex,
    initializeFromQuery,
  } = useSearchState({
    onFiltersChange: handleFiltersChange,
    getSuggestions: (input) => suggestionEngine.getSuggestions(input),
  })

  const lastExternalSearchValue = useRef(searchQuery)
  useEffect(() => {
    if (searchQuery !== lastExternalSearchValue.current) {
      lastExternalSearchValue.current = searchQuery
      const parsed = parseQuery(searchQuery)
      initializeFromQuery(parsed.textSearch, parsed.filters)
    }
  }, [searchQuery, initializeFromQuery])

  useEffect(() => {
    if (searchQuery) {
      const parsed = parseQuery(searchQuery)
      initializeFromQuery(parsed.textSearch, parsed.filters)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isSuggestionsOpen || highlightedIndex < 0) return
    const container = searchDropdownRef.current
    const el = container?.querySelector(`[data-index="${highlightedIndex}"]`)
    if (container && el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isSuggestionsOpen, highlightedIndex])

  const suggestionsDropdown = useMemo(() => {
    if (!isSuggestionsOpen || suggestions.length === 0) return undefined
    const suggestionType =
      sections.length > 0 ? 'multi-section' : (suggestions[0]?.category ?? null)

    return (
      <div className='max-h-96 overflow-y-auto px-1'>
        {sections.length > 0 ? (
          <div className='py-1'>
            {suggestions[0]?.category === 'show-all' && (
              <SuggestionButton
                suggestion={suggestions[0]}
                index={0}
                highlighted={highlightedIndex === 0}
                onHover={setHighlightedIndex}
                onSelect={handleSuggestionSelect}
              />
            )}
            {sections.map((section) => (
              <div key={section.title}>
                <div className='px-3 py-1.5 font-medium text-[var(--text-tertiary)] text-caption uppercase tracking-wide'>
                  {section.title}
                </div>
                {section.suggestions.map((suggestion) => {
                  if (suggestion.category === 'show-all') return null
                  const index = suggestions.indexOf(suggestion)
                  return (
                    <SuggestionButton
                      key={suggestion.id}
                      suggestion={suggestion}
                      index={index}
                      highlighted={index === highlightedIndex}
                      onHover={setHighlightedIndex}
                      onSelect={handleSuggestionSelect}
                      showCategory
                    />
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className='py-1'>
            {suggestionType === 'filters' && (
              <div className='px-3 py-1.5 font-medium text-[var(--text-tertiary)] text-caption uppercase tracking-wide'>
                SUGGESTED FILTERS
              </div>
            )}
            {suggestions.map((suggestion, index) => (
              <SuggestionButton
                key={suggestion.id}
                suggestion={suggestion}
                index={index}
                highlighted={index === highlightedIndex}
                onHover={setHighlightedIndex}
                onSelect={handleSuggestionSelect}
              />
            ))}
          </div>
        )}
      </div>
    )
  }, [
    isSuggestionsOpen,
    suggestions,
    sections,
    highlightedIndex,
    setHighlightedIndex,
    handleSuggestionSelect,
  ])

  const searchTags = useMemo(
    () => [
      ...appliedFilters.map((f, i) => ({
        label: f.field,
        value: `${f.operator !== '=' ? f.operator : ''}${f.originalValue}`,
        onRemove: () => removeBadge(i),
      })),
      ...(textSearch
        ? [
            {
              label: 'search',
              value: textSearch,
              onRemove: () => handleFiltersChange(appliedFilters, ''),
            },
          ]
        : []),
    ],
    [appliedFilters, textSearch, removeBadge, handleFiltersChange]
  )

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: [
        { id: 'date', label: 'Date' },
        { id: 'duration', label: 'Duration' },
        { id: 'cost', label: 'Cost' },
        { id: 'status', label: 'Status' },
      ],
      active: activeSort,
      onSort: (column, direction) => setActiveSort({ column, direction }),
      onClear: () => setActiveSort(null),
    }),
    [activeSort]
  )

  const searchConfig = useMemo<SearchConfig>(
    () => ({
      value: currentInput,
      onChange: handleSearchInputChange,
      placeholder: 'Search logs...',
      inputRef: searchInputRef,
      onKeyDown: handleSearchKeyDown,
      onFocus: handleSearchFocus,
      onBlur: handleSearchBlur,
      tags: searchTags.length > 0 ? searchTags : undefined,
      highlightedTagIndex: highlightedBadgeIndex,
      onClearAll: clearSearch,
      dropdown: suggestionsDropdown,
      dropdownRef: searchDropdownRef,
    }),
    [
      currentInput,
      handleSearchInputChange,
      searchInputRef,
      handleSearchKeyDown,
      handleSearchFocus,
      handleSearchBlur,
      searchTags,
      highlightedBadgeIndex,
      clearSearch,
      suggestionsDropdown,
      searchDropdownRef,
    ]
  )

  const refreshIcon = useMemo(() => {
    if (!isVisuallyRefreshing) return Loader
    const Spinning = (props: React.SVGProps<SVGSVGElement>) => <Loader {...props} animate />
    Spinning.displayName = 'SpinningLoader'
    return Spinning
  }, [isVisuallyRefreshing])

  const headerActions = useMemo<HeaderAction[]>(
    () => [
      {
        label: 'Export',
        icon: Download,
        onClick: handleExport,
        disabled: !userPermissions.canEdit || isExporting || sortedLogs.length === 0,
      },
      {
        label: 'Notifications',
        icon: Bell,
        onClick: handleOpenNotificationSettings,
      },
      {
        label: '',
        icon: refreshIcon,
        onClick: handleRefresh,
        disabled: isVisuallyRefreshing,
      },
      {
        label: 'Logs',
        onClick: () => setViewMode('logs'),
        disabled: !isDashboardView,
      },
      {
        label: 'Dashboard',
        onClick: () => setViewMode('dashboard'),
        disabled: isDashboardView,
      },
    ],
    [
      isDashboardView,
      setViewMode,
      refreshIcon,
      isVisuallyRefreshing,
      handleRefresh,
      handleExport,
      userPermissions.canEdit,
      isExporting,
      sortedLogs.length,
      handleOpenNotificationSettings,
    ]
  )

  return (
    <>
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
        <ResourceHeader icon={Library} title='Logs' actions={headerActions} />
        <ResourceOptionsBar
          search={searchConfig}
          sort={sortConfig}
          filter={
            <LogsFilterPanel searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />
          }
          filterTags={filterTags}
        />
        {isDashboardView ? (
          <div className='relative flex min-h-0 flex-1 flex-col overflow-auto'>
            <div className='flex min-h-0 flex-1 flex-col px-6'>
              <Dashboard
                stats={dashboardStatsQuery.data}
                isLoading={dashboardStatsQuery.isLoading}
                error={dashboardStatsQuery.error}
              />
            </div>
            {sidebarOverlay}
          </div>
        ) : (
          <ResourceTable
            columns={LOG_COLUMNS}
            rows={rows}
            selectedRowId={selectedLogId}
            onRowClick={handleLogClick}
            onRowHover={handleLogHover}
            onRowContextMenu={handleLogContextMenu}
            isLoading={!logsQuery.data}
            onLoadMore={loadMoreLogs}
            hasMore={!activeSort && (logsQuery.hasNextPage ?? false)}
            isLoadingMore={logsQuery.isFetchingNextPage}
            emptyMessage='No logs found'
            overlay={sidebarOverlay}
          />
        )}
      </div>

      <NotificationSettings
        workspaceId={workspaceId}
        open={isNotificationSettingsOpen}
        onOpenChange={setIsNotificationSettingsOpen}
      />

      <LogRowContextMenu
        isOpen={contextMenuOpen}
        position={contextMenuPosition}
        onClose={handleCloseContextMenu}
        log={contextMenuLog}
        onCopyExecutionId={handleCopyExecutionId}
        onCopyLink={handleCopyLink}
        onOpenWorkflow={handleOpenWorkflow}
        onOpenPreview={handleOpenPreview}
        onCancelExecution={handleCancelExecution}
        onToggleWorkflowFilter={handleToggleWorkflowFilter}
        onClearAllFilters={handleClearAllFilters}
        isFilteredByThisWorkflow={isFilteredByThisWorkflow}
        hasActiveFilters={filtersActive}
      />

      {isPreviewOpen && !activeLogQuery.isPlaceholderData && activeLogQuery.data?.executionId && (
        <ExecutionSnapshot
          executionId={activeLogQuery.data.executionId}
          traceSpans={activeLogQuery.data.executionData?.traceSpans}
          isModal
          isOpen={isPreviewOpen}
          onClose={handleClosePreview}
        />
      )}
    </>
  )
}

interface LogsFilterPanelProps {
  searchQuery: string
  onSearchQueryChange: (query: string) => void
}

function LogsFilterPanel({ searchQuery, onSearchQueryChange }: LogsFilterPanelProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    level,
    setLevel,
    workflowIds,
    setWorkflowIds,
    folderIds,
    setFolderIds,
    triggers,
    setTriggers,
    timeRange,
    setTimeRange,
    startDate,
    endDate,
    setDateRange,
    clearDateRange,
    resetFilters,
  } = useFilterStore(
    useShallow((s) => ({
      level: s.level,
      setLevel: s.setLevel,
      workflowIds: s.workflowIds,
      setWorkflowIds: s.setWorkflowIds,
      folderIds: s.folderIds,
      setFolderIds: s.setFolderIds,
      triggers: s.triggers,
      setTriggers: s.setTriggers,
      timeRange: s.timeRange,
      setTimeRange: s.setTimeRange,
      startDate: s.startDate,
      endDate: s.endDate,
      setDateRange: s.setDateRange,
      clearDateRange: s.clearDateRange,
      resetFilters: s.resetFilters,
    }))
  )

  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [previousTimeRange, setPreviousTimeRange] = useState(timeRange)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const { data: allWorkflowList = [] } = useWorkflows(workspaceId)

  const workflows = allWorkflowList.map((w) => ({ id: w.id, name: w.name, color: w.color }))
  const folderList = Object.values(folders).filter((f) => f.workspaceId === workspaceId)

  const selectedStatuses = level === 'all' || !level ? [] : level.split(',').filter(Boolean)

  const statusOptions: ComboboxOption[] = useMemo(
    () =>
      (Object.keys(STATUS_CONFIG) as LogStatus[]).map((status) => ({
        value: status,
        label: STATUS_CONFIG[status].label,
        icon: getColorIcon(STATUS_CONFIG[status].color),
      })),
    []
  )

  const handleStatusChange = (values: string[]) => {
    setLevel(values.length === 0 ? 'all' : values.join(','))
  }

  const statusDisplayLabel =
    selectedStatuses.length === 0
      ? 'Status'
      : selectedStatuses.length === 1
        ? statusOptions.find((s) => s.value === selectedStatuses[0])?.label || '1 selected'
        : `${selectedStatuses.length} selected`

  const selectedStatusColor =
    selectedStatuses.length === 1
      ? (STATUS_CONFIG[selectedStatuses[0] as LogStatus]?.color ?? null)
      : null

  const workflowOptions: ComboboxOption[] = workflows.map((w) => ({
    value: w.id,
    label: w.name,
    icon: getColorIcon(w.color, true),
  }))

  const workflowDisplayLabel =
    workflowIds.length === 0
      ? 'Workflow'
      : workflowIds.length === 1
        ? workflows.find((w) => w.id === workflowIds[0])?.name || '1 selected'
        : `${workflowIds.length} workflows`

  const selectedWorkflow =
    workflowIds.length === 1 ? workflows.find((w) => w.id === workflowIds[0]) : null

  const folderOptions: ComboboxOption[] = folderList.map((f) => ({ value: f.id, label: f.name }))

  const folderDisplayLabel =
    folderIds.length === 0
      ? 'Folder'
      : folderIds.length === 1
        ? folderList.find((f) => f.id === folderIds[0])?.name || '1 selected'
        : `${folderIds.length} folders`

  const triggerOptions: ComboboxOption[] = useMemo(
    () =>
      getTriggerOptions().map((t) => ({
        value: t.value,
        label: t.label,
        icon: getTriggerIcon(t.value),
      })),
    []
  )

  const triggerDisplayLabel =
    triggers.length === 0
      ? 'Trigger'
      : triggers.length === 1
        ? triggerOptions.find((t) => t.value === triggers[0])?.label || '1 selected'
        : `${triggers.length} triggers`

  const timeDisplayLabel =
    timeRange === 'All time'
      ? 'Time'
      : timeRange === 'Custom range' && startDate && endDate
        ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`
        : timeRange === 'Custom range'
          ? 'Custom range'
          : timeRange

  const handleTimeRangeChange = (val: string) => {
    if (val === 'Custom range') {
      setPreviousTimeRange(timeRange)
      setDatePickerOpen(true)
    } else {
      clearDateRange()
      setTimeRange(val as typeof timeRange)
    }
  }

  const handleDateRangeApply = (start: string, end: string) => {
    setDateRange(start, end)
    setDatePickerOpen(false)
  }

  const handleDatePickerCancel = () => {
    if (timeRange === 'Custom range' && !startDate) {
      setTimeRange(previousTimeRange)
    }
    setDatePickerOpen(false)
  }

  const filtersActive = hasActiveFilters({
    timeRange,
    level,
    workflowIds,
    folderIds,
    triggers,
    searchQuery,
  })

  const handleClearFilters = () => {
    resetFilters()
    onSearchQueryChange('')
  }

  return (
    <div className='flex w-[240px] flex-col gap-3 p-3'>
      <div className='flex flex-col gap-1.5'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Status</span>
        <Combobox
          options={statusOptions}
          multiSelect
          multiSelectValues={selectedStatuses}
          onMultiSelectChange={handleStatusChange}
          placeholder='All statuses'
          overlayContent={
            <span className='flex items-center gap-1.5 truncate text-[var(--text-primary)]'>
              {selectedStatusColor && (
                <div
                  className='flex-shrink-0 rounded-[3px]'
                  style={{ backgroundColor: selectedStatusColor, width: 8, height: 8 }}
                />
              )}
              <span className='truncate'>{statusDisplayLabel}</span>
            </span>
          }
          showAllOption
          allOptionLabel='All statuses'
          size='sm'
          className='h-[32px] w-full rounded-md'
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Workflow</span>
        <Combobox
          options={workflowOptions}
          multiSelect
          multiSelectValues={workflowIds}
          onMultiSelectChange={setWorkflowIds}
          placeholder='All workflows'
          overlayContent={
            <span className='flex items-center gap-1.5 truncate text-[var(--text-primary)]'>
              {selectedWorkflow && (
                <div
                  className='h-[8px] w-[8px] flex-shrink-0 rounded-xs border-[1.5px]'
                  style={{
                    backgroundColor: selectedWorkflow.color,
                    borderColor: workflowBorderColor(selectedWorkflow.color),
                    backgroundClip: 'padding-box',
                  }}
                />
              )}
              <span className='truncate'>{workflowDisplayLabel}</span>
            </span>
          }
          searchable
          searchPlaceholder='Search workflows...'
          showAllOption
          allOptionLabel='All workflows'
          size='sm'
          className='h-[32px] w-full rounded-md'
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Folder</span>
        <Combobox
          options={folderOptions}
          multiSelect
          multiSelectValues={folderIds}
          onMultiSelectChange={setFolderIds}
          placeholder='All folders'
          overlayContent={
            <span className='truncate text-[var(--text-primary)]'>{folderDisplayLabel}</span>
          }
          searchable
          searchPlaceholder='Search folders...'
          showAllOption
          allOptionLabel='All folders'
          size='sm'
          className='h-[32px] w-full rounded-md'
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Trigger</span>
        <Combobox
          options={triggerOptions}
          multiSelect
          multiSelectValues={triggers}
          onMultiSelectChange={setTriggers}
          placeholder='All triggers'
          overlayContent={
            <span className='truncate text-[var(--text-primary)]'>{triggerDisplayLabel}</span>
          }
          searchable
          searchPlaceholder='Search triggers...'
          showAllOption
          allOptionLabel='All triggers'
          size='sm'
          className='h-[32px] w-full rounded-md'
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Time Range</span>
        <DropdownMenu open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <DropdownMenuTrigger asChild>
            <div>
              <Combobox
                options={TIME_RANGE_OPTIONS as unknown as ComboboxOption[]}
                value={timeRange}
                onChange={handleTimeRangeChange}
                placeholder='All time'
                overlayContent={
                  <span className='truncate text-[var(--text-primary)]'>{timeDisplayLabel}</span>
                }
                size='sm'
                className='h-[32px] w-full rounded-md'
              />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side='bottom'
            align='end'
            sideOffset={4}
            collisionPadding={16}
            className='w-auto p-0'
          >
            <DatePicker
              mode='range'
              startDate={startDate}
              endDate={endDate}
              onRangeChange={handleDateRangeApply}
              onCancel={handleDatePickerCancel}
              inline
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {filtersActive && (
        <Button
          variant='active'
          onClick={handleClearFilters}
          className='h-[32px] w-full rounded-md'
        >
          Clear All Filters
        </Button>
      )}
    </div>
  )
}

function SuggestionButton({
  suggestion,
  index,
  highlighted,
  onHover,
  onSelect,
  showCategory,
}: {
  suggestion: Suggestion
  index: number
  highlighted: boolean
  onHover: (i: number) => void
  onSelect: (s: Suggestion) => void
  showCategory?: boolean
}) {
  return (
    <button
      data-index={index}
      className={cn(
        'w-full rounded-md px-3 py-2 text-left transition-colors hover-hover:bg-[var(--surface-5)]',
        highlighted && 'bg-[var(--surface-5)]'
      )}
      onMouseEnter={() => onHover(index)}
      onMouseDown={(e) => {
        e.preventDefault()
        onSelect(suggestion)
      }}
    >
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0 flex-1 truncate text-small'>{suggestion.label}</div>
        {showCategory && suggestion.value !== suggestion.label && (
          <div className='shrink-0 font-mono text-[var(--text-muted)] text-xs'>
            {suggestion.category === 'workflow' || suggestion.category === 'folder'
              ? `${suggestion.category}:`
              : ''}
          </div>
        )}
        {!showCategory && suggestion.description && (
          <div className='shrink-0 text-[var(--text-muted)] text-xs'>{suggestion.value}</div>
        )}
      </div>
    </button>
  )
}
