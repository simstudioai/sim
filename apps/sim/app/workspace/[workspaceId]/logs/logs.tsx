'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Badge, buttonVariants } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { useFolders } from '@/hooks/queries/folders'
import { useLogDetail, useLogsList } from '@/hooks/queries/logs'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { useUserPermissionsContext } from '../providers/workspace-permissions-provider'
import { Dashboard, LogDetails, LogsToolbar, NotificationSettings } from './components'
import { formatDate, formatDuration, StatusBadge, TriggerBadge } from './utils'

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

  // Sync search query from URL on mount (client-side only)
  useEffect(() => {
    const urlSearch = new URLSearchParams(window.location.search).get('search') || ''
    if (urlSearch && urlSearch !== searchQuery) {
      setSearchQuery(urlSearch)
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [isLive, setIsLive] = useState(false)
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [dashboardRefreshTrigger, setDashboardRefreshTrigger] = useState(0)
  const isSearchOpenRef = useRef<boolean>(false)
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const userPermissions = useUserPermissionsContext()

  const logFilters = useMemo(
    () => ({
      timeRange,
      level,
      workflowIds,
      folderIds,
      triggers,
      searchQuery: debouncedSearchQuery,
      limit: LOGS_PER_PAGE,
    }),
    [timeRange, level, workflowIds, folderIds, triggers, debouncedSearchQuery]
  )

  const logsQuery = useLogsList(workspaceId, logFilters, {
    enabled: Boolean(workspaceId) && isInitialized.current,
    refetchInterval: isLive ? 5000 : false,
  })

  const logDetailQuery = useLogDetail(selectedLog?.id)

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

  const handleLogClick = (log: WorkflowLog) => {
    // If clicking on the same log that's already selected and sidebar is open, close it
    if (selectedLog?.id === log.id && isSidebarOpen) {
      handleCloseSidebar()
      return
    }

    // Otherwise, select the log and open the sidebar
    setSelectedLog(log)
    const index = logs.findIndex((l) => l.id === log.id)
    setSelectedLogIndex(index)
    setIsSidebarOpen(true)
  }

  const handleNavigateNext = useCallback(() => {
    if (selectedLogIndex < logs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      const nextLog = logs[nextIndex]
      setSelectedLog(nextLog)
    }
  }, [selectedLogIndex, logs])

  const handleNavigatePrev = useCallback(() => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      const prevLog = logs[prevIndex]
      setSelectedLog(prevLog)
    }
  }, [selectedLogIndex, logs])

  const handleCloseSidebar = () => {
    setIsSidebarOpen(false)
    setSelectedLog(null)
    setSelectedLogIndex(-1)
  }

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
    // Also trigger dashboard refresh
    setDashboardRefreshTrigger((prev) => prev + 1)
  }, [logsQuery, logDetailQuery, selectedLog?.id])

  const handleToggleLive = useCallback(() => {
    const newIsLive = !isLive
    setIsLive(newIsLive)

    if (newIsLive) {
      setIsVisuallyRefreshing(true)
      setTimeout(() => setIsVisuallyRefreshing(false), REFRESH_SPINNER_DURATION_MS)
      logsQuery.refetch()
      // Also trigger dashboard refresh
      setDashboardRefreshTrigger((prev) => prev + 1)
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
    if (logsQuery.isLoading || !logsQuery.hasNextPage) return

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      if (!scrollContainer) return

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer

      const scrollPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100

      if (scrollPercentage > 60 && !logsQuery.isFetchingNextPage && logsQuery.hasNextPage) {
        loadMoreLogs()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [logsQuery.isLoading, logsQuery.hasNextPage, logsQuery.isFetchingNextPage, loadMoreLogs])

  useEffect(() => {
    const currentLoaderRef = loaderRef.current
    const scrollContainer = scrollContainerRef.current

    if (!currentLoaderRef || !scrollContainer || logsQuery.isLoading || !logsQuery.hasNextPage)
      return

    const observer = new IntersectionObserver(
      (entries) => {
        const e = entries[0]
        if (!e?.isIntersecting) return
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer
        const pct = (scrollTop / (scrollHeight - clientHeight)) * 100
        if (pct > 70 && !logsQuery.isFetchingNextPage) {
          loadMoreLogs()
        }
      },
      {
        root: scrollContainer,
        threshold: 0.1,
        rootMargin: '200px 0px 0px 0px',
      }
    )

    observer.observe(currentLoaderRef)

    return () => {
      observer.unobserve(currentLoaderRef)
    }
  }, [logsQuery.isLoading, logsQuery.hasNextPage, logsQuery.isFetchingNextPage, loadMoreLogs])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current) return
      if (logs.length === 0) return

      if (selectedLogIndex === -1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        setSelectedLogIndex(0)
        setSelectedLog(logs[0])
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
        <div className='flex flex-1 flex-col overflow-auto pt-[28px] pl-[24px]'>
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

          {/* Dashboard view */}
          {isDashboardView && (
            <div className='pr-[24px] pb-[24px]'>
              <Dashboard isLive={isLive} refreshTrigger={dashboardRefreshTrigger} />
            </div>
          )}

          {/* Main content area with table - only show in logs view */}
          {!isDashboardView && (
            <div className='relative mt-[24px] flex min-h-0 flex-1 overflow-hidden rounded-[6px]'>
              {/* Table container */}
              <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] bg-[var(--surface-1)]'>
                {/* Table header */}
                <div className='flex-shrink-0 rounded-t-[6px] bg-[var(--surface-3)] px-[24px] py-[10px]'>
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

                {/* Table body - scrollable */}
                <div
                  className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'
                  ref={scrollContainerRef}
                >
                  {logsQuery.isLoading && !logsQuery.data ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-[8px] text-[var(--text-secondary)]'>
                        <Loader2 className='h-[16px] w-[16px] animate-spin' />
                        <span className='text-[13px]'>Loading logs...</span>
                      </div>
                    </div>
                  ) : logsQuery.isError ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-[8px] text-[var(--text-error)]'>
                        <AlertCircle className='h-[16px] w-[16px]' />
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
                    <div>
                      {logs.map((log) => {
                        const formattedDate = formatDate(log.createdAt)
                        const isSelected = selectedLog?.id === log.id
                        const baseLevel = (log.level || 'info').toLowerCase()
                        const isError = baseLevel === 'error'
                        const isPending = !isError && log.hasPendingPause === true
                        const isRunning = !isError && !isPending && log.duration === null

                        return (
                          <div
                            key={log.id}
                            ref={isSelected ? selectedRowRef : null}
                            className={cn(
                              'relative flex h-[44px] cursor-pointer items-center px-[24px] hover:bg-[var(--c-2A2A2A)]',
                              isSelected && 'bg-[var(--c-2A2A2A)]'
                            )}
                            onClick={() => handleLogClick(log)}
                          >
                            <div className='flex flex-1 items-center'>
                              {/* Date */}
                              <span className='w-[8%] min-w-[70px] font-medium text-[12px] text-[var(--text-primary)]'>
                                {formattedDate.compactDate}
                              </span>

                              {/* Time */}
                              <span className='w-[12%] min-w-[90px] font-medium text-[12px] text-[var(--text-primary)]'>
                                {formattedDate.compactTime}
                              </span>

                              {/* Status */}
                              <div className='w-[12%] min-w-[100px]'>
                                <StatusBadge
                                  status={
                                    isError
                                      ? 'error'
                                      : isPending
                                        ? 'pending'
                                        : isRunning
                                          ? 'running'
                                          : 'info'
                                  }
                                />
                              </div>

                              {/* Workflow */}
                              <div className='flex w-[22%] min-w-[140px] items-center gap-[8px] pr-[8px]'>
                                <div
                                  className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]'
                                  style={{ backgroundColor: log.workflow?.color }}
                                />
                                <span className='min-w-0 truncate font-medium text-[12px] text-[var(--text-primary)]'>
                                  {log.workflow?.name || 'Unknown'}
                                </span>
                              </div>

                              {/* Cost */}
                              <span className='w-[12%] min-w-[90px] font-medium text-[12px] text-[var(--text-primary)]'>
                                {typeof log.cost?.total === 'number'
                                  ? `$${log.cost.total.toFixed(4)}`
                                  : '—'}
                              </span>

                              {/* Trigger */}
                              <div className='w-[14%] min-w-[110px]'>
                                {log.trigger ? (
                                  <TriggerBadge trigger={log.trigger} />
                                ) : (
                                  <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                                    —
                                  </span>
                                )}
                              </div>

                              {/* Duration */}
                              <div className='w-[20%] min-w-[100px]'>
                                <Badge
                                  variant='default'
                                  className='rounded-[6px] px-[9px] py-[2px] text-[12px]'
                                >
                                  {formatDuration(log.duration) || '—'}
                                </Badge>
                              </div>
                            </div>

                            {/* Resume Link */}
                            {isPending &&
                              log.executionId &&
                              (log.workflow?.id || log.workflowId) && (
                                <Link
                                  href={`/resume/${log.workflow?.id || log.workflowId}/${log.executionId}`}
                                  target='_blank'
                                  rel='noopener noreferrer'
                                  className={cn(
                                    buttonVariants({ variant: 'active' }),
                                    'absolute right-[24px] h-[26px] w-[26px] rounded-[6px] p-0'
                                  )}
                                  aria-label='Open resume console'
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ArrowUpRight className='h-[14px] w-[14px]' />
                                </Link>
                              )}
                          </div>
                        )
                      })}

                      {/* Infinite scroll loader */}
                      {logsQuery.hasNextPage && (
                        <div className='flex items-center justify-center py-[16px]'>
                          <div
                            ref={loaderRef}
                            className='flex items-center gap-[8px] text-[var(--text-secondary)]'
                          >
                            {logsQuery.isFetchingNextPage ? (
                              <>
                                <Loader2 className='h-[16px] w-[16px] animate-spin' />
                                <span className='text-[13px]'>Loading more...</span>
                              </>
                            ) : (
                              <span className='text-[13px]'>Scroll to load more</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Log Details - rendered inside table container */}
              <LogDetails
                log={logDetailQuery.data || selectedLog}
                isOpen={isSidebarOpen}
                onClose={handleCloseSidebar}
                onNavigateNext={handleNavigateNext}
                onNavigatePrev={handleNavigatePrev}
                hasNext={selectedLogIndex < logs.length - 1}
                hasPrev={selectedLogIndex > 0}
              />
            </div>
          )}
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
