'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import {
  getEndDateFromTimeRange,
  getStartDateFromTimeRange,
  hasActiveFilters,
} from '@/lib/logs/filters'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { useFolders } from '@/hooks/queries/folders'
import { useDashboardStats, useLogDetail, useLogsList } from '@/hooks/queries/logs'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { useUserPermissionsContext } from '../providers/workspace-permissions-provider'
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

  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
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
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()

  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const [contextMenuLog, setContextMenuLog] = useState<WorkflowLog | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewLogId, setPreviewLogId] = useState<string | null>(null)

  const activeLogId = isPreviewOpen ? previewLogId : selectedLogId
  const activeLogQuery = useLogDetail(activeLogId ?? undefined, {
    refetchInterval: isLive ? 3000 : false,
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

  useFolders(workspaceId)

  useEffect(() => {
    if (isInitialized.current) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, setStoreSearchQuery])

  const handleLogClick = useCallback(
    (log: WorkflowLog) => {
      if (selectedLogId === log.id && isSidebarOpen) {
        setIsSidebarOpen(false)
        setSelectedLogId(null)
        return
      }
      setSelectedLogId(log.id)
      setIsSidebarOpen(true)
    },
    [selectedLogId, isSidebarOpen]
  )

  const handleNavigateNext = useCallback(() => {
    if (selectedLogIndex < logs.length - 1) {
      setSelectedLogId(logs[selectedLogIndex + 1].id)
    }
  }, [selectedLogIndex, logs])

  const handleNavigatePrev = useCallback(() => {
    if (selectedLogIndex > 0) {
      setSelectedLogId(logs[selectedLogIndex - 1].id)
    }
  }, [selectedLogIndex, logs])

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false)
    setSelectedLogId(null)
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
    setTimeout(() => setIsVisuallyRefreshing(false), REFRESH_SPINNER_DURATION_MS)
    logsQuery.refetch()
    if (selectedLogId) {
      activeLogQuery.refetch()
    }
  }, [logsQuery, activeLogQuery, selectedLogId])

  const handleToggleLive = useCallback(() => {
    const newIsLive = !isLive
    setIsLive(newIsLive)

    if (newIsLive) {
      setIsVisuallyRefreshing(true)
      setTimeout(() => setIsVisuallyRefreshing(false), REFRESH_SPINNER_DURATION_MS)
      logsQuery.refetch()
      if (selectedLogId) {
        activeLogQuery.refetch()
      }
    }
  }, [isLive, logsQuery, activeLogQuery, selectedLogId])

  const prevIsFetchingRef = useRef(logsQuery.isFetching)
  useEffect(() => {
    const wasFetching = prevIsFetchingRef.current
    const isFetching = logsQuery.isFetching
    prevIsFetchingRef.current = isFetching

    if (isLive && !wasFetching && isFetching) {
      setIsVisuallyRefreshing(true)
      setTimeout(() => setIsVisuallyRefreshing(false), REFRESH_SPINNER_DURATION_MS)
    }
  }, [logsQuery.isFetching, isLive])

  const handleExport = async () => {
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
  }

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
    if (!logsQuery.isFetching && logsQuery.hasNextPage) {
      logsQuery.fetchNextPage()
    }
  }, [logsQuery])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current) return
      if (logs.length === 0) return

      if (selectedLogIndex === -1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        setSelectedLogId(logs[0].id)
        return
      }

      if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && selectedLogIndex > 0) {
        e.preventDefault()
        handleNavigatePrev()
      }

      if (e.key === 'ArrowDown' && !e.metaKey && !e.ctrlKey && selectedLogIndex < logs.length - 1) {
        e.preventDefault()
        handleNavigateNext()
      }

      if (e.key === 'Enter' && selectedLogId) {
        e.preventDefault()
        setIsSidebarOpen(!isSidebarOpen)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [logs, selectedLogIndex, isSidebarOpen, selectedLogId, handleNavigateNext, handleNavigatePrev])

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
              onOpenNotificationSettings={() => setIsNotificationSettingsOpen(true)}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onSearchOpenChange={(open: boolean) => {
                isSearchOpenRef.current = open
              }}
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
              <div className='min-h-0 flex-1 overflow-hidden' ref={scrollContainerRef}>
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
        onClose={() => setContextMenuOpen(false)}
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
          onClose={() => {
            setIsPreviewOpen(false)
            setPreviewLogId(null)
          }}
        />
      )}
    </div>
  )
}
