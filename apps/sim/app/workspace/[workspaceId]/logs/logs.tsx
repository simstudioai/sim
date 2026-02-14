'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import {
  getEndDateFromTimeRange,
  getStartDateFromTimeRange,
  hasActiveFilters,
} from '@/lib/logs/filters'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useFolders } from '@/hooks/queries/folders'
import {
  prefetchLogDetail,
  useDashboardStats,
  useLogDetail,
  useLogsList,
} from '@/hooks/queries/logs'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import {
  Dashboard,
  ExecutionSnapshot,
  LogDetails,
  LogRowContextMenu,
  LogsList,
  LogsToolbar,
  NotificationSettings,
} from './components'
import { LOG_COLUMN_ORDER, LOG_COLUMNS } from './utils'

const LOGS_PER_PAGE = 50 as const
const REFRESH_SPINNER_DURATION_MS = 1000 as const

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
  } = useFilterStore()

  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId, setWorkspaceId])

  const [{ selectedLogId, isSidebarOpen }, dispatch] = useReducer(logSelectionReducer, {
    selectedLogId: null,
    isSidebarOpen: false,
  })
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)

  const isInitialized = useRef<boolean>(false)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  useEffect(() => {
    const urlSearch = new URLSearchParams(window.location.search).get('search') || ''
    if (urlSearch && urlSearch !== searchQuery) {
      setSearchQuery(urlSearch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [isLive, setIsLive] = useState(true)
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const isSearchOpenRef = useRef<boolean>(false)
  const refreshTimersRef = useRef(new Set<number>())
  const logsRef = useRef<WorkflowLog[]>([])
  const selectedLogIndexRef = useRef(-1)
  const selectedLogIdRef = useRef<string | null>(null)
  const logsRefetchRef = useRef<() => void>(() => {})
  const activeLogRefetchRef = useRef<() => void>(() => {})
  const logsQueryRef = useRef({ isFetching: false, hasNextPage: false, fetchNextPage: () => {} })
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()

  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [contextMenuLog, setContextMenuLog] = useState<WorkflowLog | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

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

  const selectedLogIndex = useMemo(
    () => (selectedLogId ? logs.findIndex((l) => l.id === selectedLogId) : -1),
    [logs, selectedLogId]
  )
  const selectedLogFromList = selectedLogIndex >= 0 ? logs[selectedLogIndex] : null

  const selectedLog = useMemo(() => {
    if (!selectedLogFromList) return null
    if (!activeLogQuery.data || isPreviewOpen) return selectedLogFromList
    return { ...selectedLogFromList, ...activeLogQuery.data }
  }, [selectedLogFromList, activeLogQuery.data, isPreviewOpen])

  const handleLogHover = useCallback(
    (log: WorkflowLog) => {
      prefetchLogDetail(queryClient, log.id)
    },
    [queryClient]
  )

  useFolders(workspaceId)

  useEffect(() => {
    logsRef.current = logs
  }, [logs])
  useEffect(() => {
    selectedLogIndexRef.current = selectedLogIndex
  }, [selectedLogIndex])
  useEffect(() => {
    selectedLogIdRef.current = selectedLogId
  }, [selectedLogId])
  logsRefetchRef.current = logsQuery.refetch
  activeLogRefetchRef.current = activeLogQuery.refetch
  logsQueryRef.current = {
    isFetching: logsQuery.isFetching,
    hasNextPage: logsQuery.hasNextPage ?? false,
    fetchNextPage: logsQuery.fetchNextPage,
  }

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

  const handleLogClick = useCallback((log: WorkflowLog) => {
    dispatch({ type: 'TOGGLE_LOG', logId: log.id })
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

  const handleLogContextMenu = useCallback((e: React.MouseEvent, log: WorkflowLog) => {
    e.preventDefault()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setContextMenuLog(log)
    setContextMenuOpen(true)
  }, [])

  const handleCopyExecutionId = useCallback(() => {
    if (contextMenuLog?.executionId) {
      navigator.clipboard.writeText(contextMenuLog.executionId)
    }
  }, [contextMenuLog])

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
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedLogIndex])

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

  const handleToggleLive = useCallback(() => {
    setIsLive((prev) => {
      if (!prev) {
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
      }
      return !prev
    })
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
    const { isFetching, hasNextPage, fetchNextPage } = logsQueryRef.current
    if (!isFetching && hasNextPage) {
      fetchNextPage()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current) return
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
  const handleSearchOpenChange = useCallback((open: boolean) => {
    isSearchOpenRef.current = open
  }, [])
  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false)
    setPreviewLogId(null)
  }, [])

  const isDashboardView = viewMode === 'dashboard'

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white pt-[28px] pl-[24px] dark:bg-[var(--bg)]'>
          <div className='pr-[24px]'>
            <LogsToolbar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              isRefreshing={isVisuallyRefreshing}
              onRefresh={handleRefresh}
              isLive={isLive}
              onToggleLive={handleToggleLive}
              isExporting={isExporting}
              onExport={handleExport}
              canEdit={userPermissions.canEdit}
              hasLogs={logs.length > 0}
              onOpenNotificationSettings={handleOpenNotificationSettings}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onSearchOpenChange={handleSearchOpenChange}
            />
          </div>

          {/* Dashboard view - uses all logs (non-paginated) for accurate metrics */}
          <div
            className={cn('flex min-h-0 flex-1 flex-col pr-[24px]', !isDashboardView && 'hidden')}
          >
            <Dashboard
              stats={dashboardStatsQuery.data}
              isLoading={dashboardStatsQuery.isLoading}
              error={dashboardStatsQuery.error}
            />
          </div>

          {/* Main content area with table - only show in logs view */}
          <div
            className={cn(
              'relative mt-[24px] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px]',
              isDashboardView && 'hidden'
            )}
          >
            {/* Table container */}
            <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-1)]'>
              {/* Table header */}
              <div className='flex-shrink-0 rounded-t-[6px] bg-[var(--surface-3)] px-[24px] py-[10px] dark:bg-[var(--surface-3)]'>
                <div className='flex items-center'>
                  {LOG_COLUMN_ORDER.map((key) => {
                    const col = LOG_COLUMNS[key]
                    return (
                      <span
                        key={key}
                        className={`${col.width} ${col.minWidth} font-medium text-[12px] text-[var(--text-tertiary)]`}
                      >
                        {col.label}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Table body - virtualized */}
              <div className='min-h-0 flex-1 overflow-hidden'>
                {logsQuery.isLoading && !logsQuery.data ? (
                  <div className='flex h-full items-center justify-center'>
                    <div className='flex items-center gap-[8px] text-[var(--text-secondary)]'>
                      <Loader2 className='h-[16px] w-[16px] animate-spin' />
                      <span className='text-[13px]'>Loading logs...</span>
                    </div>
                  </div>
                ) : logsQuery.isError ? (
                  <div className='flex h-full items-center justify-center'>
                    <div className='text-[var(--text-error)]'>
                      <span className='text-[13px]'>
                        Error: {logsQuery.error?.message || 'Failed to load logs'}
                      </span>
                    </div>
                  </div>
                ) : logs.length === 0 ? (
                  <div className='flex h-full items-center justify-center'>
                    <div className='flex items-center gap-[8px] text-[var(--text-secondary)]'>
                      <span className='text-[13px]'>No logs found</span>
                    </div>
                  </div>
                ) : (
                  <LogsList
                    logs={logs}
                    selectedLogId={selectedLogId}
                    onLogClick={handleLogClick}
                    onLogHover={handleLogHover}
                    onLogContextMenu={handleLogContextMenu}
                    selectedRowRef={selectedRowRef}
                    hasNextPage={logsQuery.hasNextPage ?? false}
                    isFetchingNextPage={logsQuery.isFetchingNextPage}
                    onLoadMore={loadMoreLogs}
                    loaderRef={loaderRef}
                  />
                )}
              </div>
            </div>

            {/* Log Details - rendered inside table container */}
            <LogDetails
              log={selectedLog}
              isOpen={isSidebarOpen}
              onClose={handleCloseSidebar}
              onNavigateNext={handleNavigateNext}
              onNavigatePrev={handleNavigatePrev}
              hasNext={selectedLogIndex < logs.length - 1}
              hasPrev={selectedLogIndex > 0}
            />
          </div>
        </div>
      </div>

      <NotificationSettings
        workspaceId={workspaceId}
        open={isNotificationSettingsOpen}
        onOpenChange={setIsNotificationSettingsOpen}
      />

      <LogRowContextMenu
        isOpen={contextMenuOpen}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        onClose={handleCloseContextMenu}
        log={contextMenuLog}
        onCopyExecutionId={handleCopyExecutionId}
        onOpenWorkflow={handleOpenWorkflow}
        onOpenPreview={handleOpenPreview}
        onToggleWorkflowFilter={handleToggleWorkflowFilter}
        onClearAllFilters={handleClearAllFilters}
        isFilteredByThisWorkflow={isFilteredByThisWorkflow}
        hasActiveFilters={filtersActive}
      />

      {isPreviewOpen && activeLogQuery.data?.executionId && (
        <ExecutionSnapshot
          executionId={activeLogQuery.data.executionId}
          traceSpans={activeLogQuery.data.executionData?.traceSpans}
          isModal
          isOpen={isPreviewOpen}
          onClose={handleClosePreview}
        />
      )}
    </div>
  )
}
