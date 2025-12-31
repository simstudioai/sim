'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { useFolders } from '@/hooks/queries/folders'
import { useDashboardLogs, useLogDetail, useLogsList } from '@/hooks/queries/logs'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { useUserPermissionsContext } from '../providers/workspace-permissions-provider'
import { Dashboard, LogDetails, LogsList, LogsToolbar, NotificationSettings } from './components'

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
    setSearchQuery: setStoreSearchQuery,
    triggers,
    viewMode,
    setViewMode,
  } = useFilterStore()

  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId, setWorkspaceId])

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
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

  const [isLive, setIsLive] = useState(false)
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const isSearchOpenRef = useRef<boolean>(false)
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()

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
    refetchInterval: isLive ? 5000 : false,
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

  const dashboardLogsQuery = useDashboardLogs(workspaceId, dashboardFilters, {
    enabled: Boolean(workspaceId) && isInitialized.current,
    refetchInterval: isLive ? 5000 : false,
  })

  const logDetailQuery = useLogDetail(selectedLog?.id)

  const mergedSelectedLog = useMemo(() => {
    if (!selectedLog) return null
    if (!logDetailQuery.data) return selectedLog
    return { ...selectedLog, ...logDetailQuery.data }
  }, [selectedLog, logDetailQuery.data])

  const logs = useMemo(() => {
    if (!logsQuery.data?.pages) return []
    return logsQuery.data.pages.flatMap((page) => page.logs)
  }, [logsQuery.data?.pages])

  useFolders(workspaceId)

  useEffect(() => {
    if (isInitialized.current) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, setStoreSearchQuery])

  const prevSelectedLogRef = useRef<WorkflowLog | null>(null)

  useEffect(() => {
    if (!selectedLog?.id || logs.length === 0) return

    const updatedLog = logs.find((l) => l.id === selectedLog.id)
    if (!updatedLog) return

    const prevLog = prevSelectedLogRef.current

    const hasStatusChange =
      prevLog?.id === updatedLog.id &&
      (updatedLog.duration !== prevLog.duration || updatedLog.status !== prevLog.status)

    if (updatedLog !== selectedLog) {
      setSelectedLog(updatedLog)
      prevSelectedLogRef.current = updatedLog
    }

    const newIndex = logs.findIndex((l) => l.id === selectedLog.id)
    if (newIndex !== selectedLogIndex) {
      setSelectedLogIndex(newIndex)
    }

    if (hasStatusChange) {
      logDetailQuery.refetch()
    }
  }, [logs, selectedLog?.id, selectedLogIndex, logDetailQuery])

  useEffect(() => {
    if (!isLive || !selectedLog?.id) return

    const interval = setInterval(() => {
      logDetailQuery.refetch()
    }, 5000)

    return () => clearInterval(interval)
  }, [isLive, selectedLog?.id, logDetailQuery])

  const handleLogClick = useCallback(
    (log: WorkflowLog) => {
      if (selectedLog?.id === log.id && isSidebarOpen) {
        setIsSidebarOpen(false)
        setSelectedLog(null)
        setSelectedLogIndex(-1)
        prevSelectedLogRef.current = null
        return
      }

      setSelectedLog(log)
      prevSelectedLogRef.current = log
      const index = logs.findIndex((l) => l.id === log.id)
      setSelectedLogIndex(index)
      setIsSidebarOpen(true)
    },
    [selectedLog?.id, isSidebarOpen, logs]
  )

  const handleNavigateNext = useCallback(() => {
    if (selectedLogIndex < logs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      const nextLog = logs[nextIndex]
      setSelectedLog(nextLog)
      prevSelectedLogRef.current = nextLog
    }
  }, [selectedLogIndex, logs])

  const handleNavigatePrev = useCallback(() => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      const prevLog = logs[prevIndex]
      setSelectedLog(prevLog)
      prevSelectedLogRef.current = prevLog
    }
  }, [selectedLogIndex, logs])

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false)
    setSelectedLog(null)
    setSelectedLogIndex(-1)
    prevSelectedLogRef.current = null
  }, [])

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
    if (selectedLog?.id) {
      logDetailQuery.refetch()
    }
  }, [logsQuery, logDetailQuery, selectedLog?.id])

  const handleToggleLive = useCallback(() => {
    const newIsLive = !isLive
    setIsLive(newIsLive)

    if (newIsLive) {
      setIsVisuallyRefreshing(true)
      setTimeout(() => setIsVisuallyRefreshing(false), REFRESH_SPINNER_DURATION_MS)
      logsQuery.refetch()
    }
  }, [isLive, logsQuery])

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
        setSelectedLogIndex(0)
        setSelectedLog(logs[0])
        prevSelectedLogRef.current = logs[0]
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

      if (e.key === 'Enter' && selectedLog) {
        e.preventDefault()
        setIsSidebarOpen(!isSidebarOpen)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [logs, selectedLogIndex, isSidebarOpen, selectedLog, handleNavigateNext, handleNavigatePrev])

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
              logs={dashboardLogsQuery.data ?? []}
              isLoading={!dashboardLogsQuery.data}
              error={dashboardLogsQuery.error}
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
                  <span className='w-[8%] min-w-[70px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Date
                  </span>
                  <span className='w-[12%] min-w-[90px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Time
                  </span>
                  <span className='w-[12%] min-w-[100px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Status
                  </span>
                  <span className='w-[22%] min-w-[140px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Workflow
                  </span>
                  <span className='w-[12%] min-w-[90px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Cost
                  </span>
                  <span className='w-[14%] min-w-[110px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Trigger
                  </span>
                  <span className='w-[20%] min-w-[100px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Duration
                  </span>
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
                    selectedLogId={selectedLog?.id ?? null}
                    onLogClick={handleLogClick}
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
              log={mergedSelectedLog}
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
    </div>
  )
}
