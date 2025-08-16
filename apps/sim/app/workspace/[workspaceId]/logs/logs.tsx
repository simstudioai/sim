'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2, Play, RefreshCw, Search, Square } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { Sidebar } from '@/app/workspace/[workspaceId]/logs/components/sidebar/sidebar'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils/format-date'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { LogsResponse, WorkflowLog } from '@/stores/logs/filters/types'

const logger = createLogger('Logs')
const LOGS_PER_PAGE = 50

// Get color for different trigger types using app's color scheme
const getTriggerColor = (trigger: string | null | undefined): string => {
  if (!trigger) return '#9ca3af'

  switch (trigger.toLowerCase()) {
    case 'manual':
      return '#9ca3af' // gray-400 (matches secondary styling better)
    case 'schedule':
      return '#10b981' // green (emerald-500)
    case 'webhook':
      return '#f97316' // orange (orange-500)
    case 'chat':
      return '#8b5cf6' // purple (violet-500)
    case 'api':
      return '#3b82f6' // blue (blue-500)
    default:
      return '#9ca3af' // gray-400
  }
}

const selectedRowAnimation = `
  @keyframes borderPulse {
    0% { border-left-color: hsl(var(--primary) / 0.3) }
    50% { border-left-color: hsl(var(--primary) / 0.7) }
    100% { border-left-color: hsl(var(--primary) / 0.5) }
  }
  .selected-row {
    animation: borderPulse 1s ease-in-out
    border-left-color: hsl(var(--primary) / 0.5)
  }
`

export default function Logs() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    logs,
    loading,
    error,
    setLogs,
    setLoading,
    setError,
    setWorkspaceId,
    page,
    setPage,
    hasMore,
    setHasMore,
    isFetchingMore,
    setIsFetchingMore,
    initializeFromURL,
    timeRange,
    level,
    workflowIds,
    folderIds,
    searchQuery: storeSearchQuery,
    setSearchQuery: setStoreSearchQuery,
    triggers,
  } = useFilterStore()

  // Set workspace ID in store when component mounts or workspaceId changes
  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId])

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const detailsCacheRef = useRef<Map<string, any>>(new Map())
  const detailsAbortRef = useRef<AbortController | null>(null)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isInitialized = useRef<boolean>(false)

  // Local search state with debouncing for the header
  const [searchQuery, setSearchQuery] = useState(storeSearchQuery)
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  // Live and refresh state
  const [isLive, setIsLive] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const liveIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Sync local search query with store search query
  useEffect(() => {
    setSearchQuery(storeSearchQuery)
  }, [storeSearchQuery])

  // Update store when debounced search query changes
  useEffect(() => {
    if (isInitialized.current && debouncedSearchQuery !== storeSearchQuery) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, storeSearchQuery])

  const handleLogClick = (log: WorkflowLog) => {
    setSelectedLog(log)
    const index = logs.findIndex((l) => l.id === log.id)
    setSelectedLogIndex(index)
    setIsSidebarOpen(true)

    // Fetch details for current, previous, and next concurrently with cache
    const currentId = log.id
    const prevId = index > 0 ? logs[index - 1]?.id : undefined
    const nextId = index < logs.length - 1 ? logs[index + 1]?.id : undefined

    // Abort any previous details fetch batch
    if (detailsAbortRef.current) {
      try {
        detailsAbortRef.current.abort()
      } catch {
        /* no-op */
      }
    }
    const controller = new AbortController()
    detailsAbortRef.current = controller

    const idsToFetch: Array<{ id: string; merge: boolean }> = []
    if (currentId && !detailsCacheRef.current.has(currentId))
      idsToFetch.push({ id: currentId, merge: true })
    if (prevId && !detailsCacheRef.current.has(prevId))
      idsToFetch.push({ id: prevId, merge: false })
    if (nextId && !detailsCacheRef.current.has(nextId))
      idsToFetch.push({ id: nextId, merge: false })

    if (idsToFetch.length === 0) {
      const cached = detailsCacheRef.current.get(currentId)
      if (cached) {
        setSelectedLog((prev) =>
          prev && prev.id === currentId ? ({ ...(prev as any), ...(cached as any) } as any) : prev
        )
      }
      return
    }

    Promise.all(
      idsToFetch.map(async ({ id, merge }) => {
        try {
          const res = await fetch(`/api/logs/by-id/${id}`, { signal: controller.signal })
          if (!res.ok) return
          const body = await res.json()
          const detailed = body?.data
          if (detailed) {
            detailsCacheRef.current.set(id, detailed)
            if (merge && id === currentId) {
              setSelectedLog((prev) =>
                prev && prev.id === id ? ({ ...(prev as any), ...(detailed as any) } as any) : prev
              )
            }
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') return
        }
      })
    ).catch(() => {})
  }

  const handleNavigateNext = useCallback(() => {
    if (selectedLogIndex < logs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      const nextLog = logs[nextIndex]
      setSelectedLog(nextLog)
      // Abort any previous details fetch batch
      if (detailsAbortRef.current) {
        try {
          detailsAbortRef.current.abort()
        } catch {
          /* no-op */
        }
      }
      const controller = new AbortController()
      detailsAbortRef.current = controller

      const cached = detailsCacheRef.current.get(nextLog.id)
      if (cached) {
        setSelectedLog((prev) =>
          prev && prev.id === nextLog.id ? ({ ...(prev as any), ...(cached as any) } as any) : prev
        )
      } else {
        const prevId = nextIndex > 0 ? logs[nextIndex - 1]?.id : undefined
        const afterId = nextIndex < logs.length - 1 ? logs[nextIndex + 1]?.id : undefined
        const idsToFetch: Array<{ id: string; merge: boolean }> = []
        if (nextLog.id && !detailsCacheRef.current.has(nextLog.id))
          idsToFetch.push({ id: nextLog.id, merge: true })
        if (prevId && !detailsCacheRef.current.has(prevId))
          idsToFetch.push({ id: prevId, merge: false })
        if (afterId && !detailsCacheRef.current.has(afterId))
          idsToFetch.push({ id: afterId, merge: false })
        Promise.all(
          idsToFetch.map(async ({ id, merge }) => {
            try {
              const res = await fetch(`/api/logs/by-id/${id}`, { signal: controller.signal })
              if (!res.ok) return
              const body = await res.json()
              const detailed = body?.data
              if (detailed) {
                detailsCacheRef.current.set(id, detailed)
                if (merge && id === nextLog.id) {
                  setSelectedLog((prev) =>
                    prev && prev.id === id
                      ? ({ ...(prev as any), ...(detailed as any) } as any)
                      : prev
                  )
                }
              }
            } catch (e: any) {
              if (e?.name === 'AbortError') return
            }
          })
        ).catch(() => {})
      }
    }
  }, [selectedLogIndex, logs])

  const handleNavigatePrev = useCallback(() => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      const prevLog = logs[prevIndex]
      setSelectedLog(prevLog)
      // Abort any previous details fetch batch
      if (detailsAbortRef.current) {
        try {
          detailsAbortRef.current.abort()
        } catch {
          /* no-op */
        }
      }
      const controller = new AbortController()
      detailsAbortRef.current = controller

      const cached = detailsCacheRef.current.get(prevLog.id)
      if (cached) {
        setSelectedLog((prev) =>
          prev && prev.id === prevLog.id ? ({ ...(prev as any), ...(cached as any) } as any) : prev
        )
      } else {
        const beforeId = prevIndex > 0 ? logs[prevIndex - 1]?.id : undefined
        const afterId = prevIndex < logs.length - 1 ? logs[prevIndex + 1]?.id : undefined
        const idsToFetch: Array<{ id: string; merge: boolean }> = []
        if (prevLog.id && !detailsCacheRef.current.has(prevLog.id))
          idsToFetch.push({ id: prevLog.id, merge: true })
        if (beforeId && !detailsCacheRef.current.has(beforeId))
          idsToFetch.push({ id: beforeId, merge: false })
        if (afterId && !detailsCacheRef.current.has(afterId))
          idsToFetch.push({ id: afterId, merge: false })
        Promise.all(
          idsToFetch.map(async ({ id, merge }) => {
            try {
              const res = await fetch(`/api/logs/by-id/${id}`, { signal: controller.signal })
              if (!res.ok) return
              const body = await res.json()
              const detailed = body?.data
              if (detailed) {
                detailsCacheRef.current.set(id, detailed)
                if (merge && id === prevLog.id) {
                  setSelectedLog((prev) =>
                    prev && prev.id === id
                      ? ({ ...(prev as any), ...(detailed as any) } as any)
                      : prev
                  )
                }
              }
            } catch (e: any) {
              if (e?.name === 'AbortError') return
            }
          })
        ).catch(() => {})
      }
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

  const fetchLogs = useCallback(async (pageNum: number, append = false) => {
    try {
      if (pageNum === 1) {
        setLoading(true)
      } else {
        setIsFetchingMore(true)
      }

      // Get fresh query params by calling buildQueryParams from store
      const { buildQueryParams: getCurrentQueryParams } = useFilterStore.getState()
      const queryParams = getCurrentQueryParams(pageNum, LOGS_PER_PAGE)
      const response = await fetch(`/api/logs?${queryParams}&details=basic`)

      if (!response.ok) {
        throw new Error(`Error fetching logs: ${response.statusText}`)
      }

      const data: LogsResponse = await response.json()

      setHasMore(data.data.length === LOGS_PER_PAGE && data.page < data.totalPages)

      setLogs(data.data, append)

      setError(null)
    } catch (err) {
      logger.error('Failed to fetch logs:', { err })
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      if (pageNum === 1) {
        setLoading(false)
      } else {
        setIsFetchingMore(false)
      }
    }
  }, [])

  const handleRefresh = async () => {
    if (isRefreshing) return

    setIsRefreshing(true)

    try {
      await fetchLogs(1)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      setIsRefreshing(false)
    }
  }

  // Setup or clear the live refresh interval when isLive changes
  useEffect(() => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }

    if (isLive) {
      handleRefresh()
      liveIntervalRef.current = setInterval(() => {
        handleRefresh()
      }, 5000)
    }

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
        liveIntervalRef.current = null
      }
    }
  }, [isLive])

  const toggleLive = () => {
    setIsLive(!isLive)
  }

  // Initialize filters from URL on mount
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true
      initializeFromURL()
    }
  }, [initializeFromURL])

  // Handle browser navigation events (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      initializeFromURL()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [initializeFromURL])

  // Single useEffect to handle both initial load and filter changes
  useEffect(() => {
    // Only fetch logs after initialization
    if (!isInitialized.current) {
      return
    }

    // Reset pagination and fetch from beginning
    setPage(1)
    setHasMore(true)

    // Inline fetch logic to avoid circular dependency
    const fetchWithFilters = async () => {
      try {
        setLoading(true)

        // Build query params inline to avoid dependency issues
        const params = new URLSearchParams()
        params.set('details', 'basic')
        params.set('limit', LOGS_PER_PAGE.toString())
        params.set('offset', '0') // Always start from page 1
        params.set('workspaceId', workspaceId)

        // Add filters
        if (level !== 'all') params.set('level', level)
        if (triggers.length > 0) params.set('triggers', triggers.join(','))
        if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
        if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))
        if (searchQuery.trim()) params.set('search', searchQuery.trim())

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

        const response = await fetch(`/api/logs?${params.toString()}`)

        if (!response.ok) {
          throw new Error(`Error fetching logs: ${response.statusText}`)
        }

        const data: LogsResponse = await response.json()
        setHasMore(data.data.length === LOGS_PER_PAGE && data.page < data.totalPages)
        setLogs(data.data, false)
        setError(null)
      } catch (err) {
        logger.error('Failed to fetch logs:', { err })
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchWithFilters()
  }, [workspaceId, timeRange, level, workflowIds, folderIds, searchQuery, triggers])

  const loadMoreLogs = useCallback(() => {
    if (!isFetchingMore && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      setIsFetchingMore(true)
      setTimeout(() => {
        fetchLogs(nextPage, true)
      }, 50)
    }
  }, [fetchLogs, isFetchingMore, hasMore, page])

  useEffect(() => {
    if (loading || !hasMore) return

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      if (!scrollContainer) return

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer

      const scrollPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100

      if (scrollPercentage > 60 && !isFetchingMore && hasMore) {
        loadMoreLogs()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [loading, hasMore, isFetchingMore, loadMoreLogs])

  useEffect(() => {
    const currentLoaderRef = loaderRef.current
    const scrollContainer = scrollContainerRef.current

    if (!currentLoaderRef || !scrollContainer || loading || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingMore) {
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
  }, [loading, hasMore, isFetchingMore, loadMoreLogs])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  return (
    <div className='flex h-[100vh] min-w-0 flex-col pl-64'>
      {/* Add the animation styles */}
      <style jsx global>
        {selectedRowAnimation}
      </style>

      <div className='flex min-w-0 flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto p-6'>
          {/* Header */}
          <div className='mb-5'>
            <h1 className='font-sans font-semibold text-3xl text-foreground tracking-[0.01em]'>
              Logs
            </h1>
          </div>

          {/* Search and Controls */}
          <div className='mb-8 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center'>
            <div className='flex h-9 w-full min-w-[200px] max-w-[460px] items-center gap-2 rounded-lg border bg-transparent pr-2 pl-3'>
              <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
              <Input
                placeholder='Search logs...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>

            <div className='flex flex-shrink-0 items-center gap-3'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={handleRefresh}
                    className='h-9 rounded-[11px] hover:bg-secondary'
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? (
                      <Loader2 className='h-5 w-5 animate-spin' />
                    ) : (
                      <RefreshCw className='h-5 w-5' />
                    )}
                    <span className='sr-only'>Refresh</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isRefreshing ? 'Refreshing...' : 'Refresh'}</TooltipContent>
              </Tooltip>

              <Button
                className={`group h-9 gap-2 rounded-[11px] border bg-card text-card-foreground shadow-xs transition-all duration-200 hover:border-[var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hex)] hover:text-white ${
                  isLive
                    ? 'border-[var(--brand-primary-hex)] bg-[var(--brand-primary-hex)] text-white'
                    : 'border-border'
                }`}
                onClick={toggleLive}
              >
                {isLive ? (
                  <Square className='!h-3.5 !w-3.5 fill-current' />
                ) : (
                  <Play className='!h-3.5 !w-3.5 group-hover:fill-current' />
                )}
                <span>Live</span>
              </Button>
            </div>
          </div>

          {/* Table container */}
          <div className='flex flex-1 flex-col overflow-hidden'>
            {/* Table with responsive layout */}
            <div className='w-full overflow-x-auto'>
              {/* Header */}
              <div>
                <div className='border-border border-b'>
                  <div className='grid min-w-[600px] grid-cols-[120px_80px_120px_120px] gap-2 px-2 pb-3 md:grid-cols-[140px_90px_140px_120px] md:gap-3 lg:min-w-0 lg:grid-cols-[160px_100px_160px_120px] lg:gap-4 xl:grid-cols-[160px_100px_160px_120px_120px_100px]'>
                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                      Time
                    </div>
                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                      Status
                    </div>
                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                      Workflow
                    </div>
                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                      Cost
                    </div>
                    <div className='hidden font-[480] font-sans text-[13px] text-muted-foreground leading-normal xl:block'>
                      Trigger
                    </div>

                    <div className='hidden font-[480] font-sans text-[13px] text-muted-foreground leading-normal xl:block'>
                      Duration
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Table body - scrollable */}
            <div className='flex-1 overflow-auto' ref={scrollContainerRef}>
              {loading && page === 1 ? (
                <div className='flex h-full items-center justify-center'>
                  <div className='flex items-center gap-2 text-muted-foreground'>
                    <Loader2 className='h-5 w-5 animate-spin' />
                    <span className='text-sm'>Loading logs...</span>
                  </div>
                </div>
              ) : error ? (
                <div className='flex h-full items-center justify-center'>
                  <div className='flex items-center gap-2 text-destructive'>
                    <AlertCircle className='h-5 w-5' />
                    <span className='text-sm'>Error: {error}</span>
                  </div>
                </div>
              ) : logs.length === 0 ? (
                <div className='flex h-full items-center justify-center'>
                  <div className='flex items-center gap-2 text-muted-foreground'>
                    <Info className='h-5 w-5' />
                    <span className='text-sm'>No logs found</span>
                  </div>
                </div>
              ) : (
                <div className='pb-4'>
                  {logs.map((log) => {
                    const formattedDate = formatDate(log.createdAt)
                    const isSelected = selectedLog?.id === log.id

                    return (
                      <div
                        key={log.id}
                        ref={isSelected ? selectedRowRef : null}
                        className={`cursor-pointer border-border border-b transition-all duration-200 ${
                          isSelected ? 'bg-accent/40' : 'hover:bg-accent/20'
                        }`}
                        onClick={() => handleLogClick(log)}
                      >
                        <div className='grid min-w-[600px] grid-cols-[120px_80px_120px_120px] items-center gap-2 px-2 py-4 md:grid-cols-[140px_90px_140px_120px] md:gap-3 lg:min-w-0 lg:grid-cols-[160px_100px_160px_120px] lg:gap-4 xl:grid-cols-[160px_100px_160px_120px_120px_100px]'>
                          {/* Time */}
                          <div>
                            <div className='text-[13px]'>
                              <span className='font-sm text-muted-foreground'>
                                {formattedDate.compactDate}
                              </span>
                              <span
                                style={{ marginLeft: '8px' }}
                                className='hidden font-medium sm:inline'
                              >
                                {formattedDate.compactTime}
                              </span>
                            </div>
                          </div>

                          {/* Status */}
                          <div>
                            <div
                              className={cn(
                                'inline-flex items-center rounded-[8px] px-[6px] py-[2px] font-medium text-xs transition-all duration-200 lg:px-[8px]',
                                log.level === 'error'
                                  ? 'bg-red-500 text-white'
                                  : 'bg-secondary text-card-foreground'
                              )}
                            >
                              {log.level}
                            </div>
                          </div>

                          {/* Workflow */}
                          <div className='min-w-0'>
                            <div className='truncate font-medium text-[13px]'>
                              {log.workflow?.name || 'Unknown Workflow'}
                            </div>
                          </div>

                          {/* Cost */}
                          <div>
                            <div className='font-medium text-muted-foreground text-xs'>
                              {typeof (log as any)?.cost?.total === 'number'
                                ? `$${((log as any).cost.total as number).toFixed(4)}`
                                : '—'}
                            </div>
                          </div>

                          {/* Trigger */}
                          <div className='hidden xl:block'>
                            {log.trigger ? (
                              <div
                                className={cn(
                                  'inline-flex items-center rounded-[8px] px-[6px] py-[2px] font-medium text-xs transition-all duration-200 lg:px-[8px]',
                                  log.trigger.toLowerCase() === 'manual'
                                    ? 'bg-secondary text-card-foreground'
                                    : 'text-white'
                                )}
                                style={
                                  log.trigger.toLowerCase() === 'manual'
                                    ? undefined
                                    : { backgroundColor: getTriggerColor(log.trigger) }
                                }
                              >
                                {log.trigger}
                              </div>
                            ) : (
                              <div className='text-muted-foreground text-xs'>—</div>
                            )}
                          </div>

                          {/* Duration */}
                          <div className='hidden xl:block'>
                            <div className='text-muted-foreground text-xs'>
                              {log.duration || '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Infinite scroll loader */}
                  {hasMore && (
                    <div className='flex items-center justify-center py-4'>
                      <div
                        ref={loaderRef}
                        className='flex items-center gap-2 text-muted-foreground'
                      >
                        {isFetchingMore ? (
                          <>
                            <Loader2 className='h-4 w-4 animate-spin' />
                            <span className='text-sm'>Loading more...</span>
                          </>
                        ) : (
                          <span className='text-sm'>Scroll to load more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log Sidebar */}
      <Sidebar
        log={selectedLog}
        isOpen={isSidebarOpen}
        onClose={handleCloseSidebar}
        onNavigateNext={handleNavigateNext}
        onNavigatePrev={handleNavigatePrev}
        hasNext={selectedLogIndex < logs.length - 1}
        hasPrev={selectedLogIndex > 0}
      />
    </div>
  )
}
