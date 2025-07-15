'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'
import { ControlBar } from './components/control-bar/control-bar'
import { Filters } from './components/filters/filters'
import { Sidebar } from './components/sidebar/sidebar'
import { useFilterStore } from './stores/store'
import type { LogsResponse, WorkflowLog } from './stores/types'
import { formatDate } from './utils/format-date'

const logger = createLogger('Logs')
const LOGS_PER_PAGE = 50

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
  const {
    logs,
    loading,
    error,
    setLogs,
    setLoading,
    setError,
    page,
    setPage,
    hasMore,
    setHasMore,
    isFetchingMore,
    setIsFetchingMore,
    buildQueryParams,
    timeRange,
    level,
    workflowIds,
    folderIds,
    searchQuery,
    triggers,
  } = useFilterStore()

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const handleLogClick = (log: WorkflowLog) => {
    setSelectedLog(log)
    const index = logs.findIndex((l) => l.id === log.id)
    setSelectedLogIndex(index)
    setIsSidebarOpen(true)
  }

  const handleNavigateNext = () => {
    if (selectedLogIndex < logs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      setSelectedLog(logs[nextIndex])
    }
  }

  const handleNavigatePrev = () => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      setSelectedLog(logs[prevIndex])
    }
  }

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

  const fetchLogs = useCallback(
    async (pageNum: number, append = false) => {
      try {
        if (pageNum === 1) {
          setLoading(true)
        } else {
          setIsFetchingMore(true)
        }

        const queryParams = buildQueryParams(pageNum, LOGS_PER_PAGE)
        const response = await fetch(`/api/logs/enhanced?${queryParams}`)

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
    },
    [setLogs, setLoading, setError, setHasMore, setIsFetchingMore, buildQueryParams]
  )

  useEffect(() => {
    fetchLogs(1)
  }, [fetchLogs])

  // Refetch when filters change (but not on initial load)
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    // Reset pagination and fetch from beginning when filters change
    setPage(1)
    setHasMore(true)

    // Fetch logs with new filters
    const fetchWithNewFilters = async () => {
      try {
        setLoading(true)
        const queryParams = buildQueryParams(1, LOGS_PER_PAGE)
        const response = await fetch(`/api/logs/enhanced?${queryParams}`)

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

    fetchWithNewFilters()
  }, [
    timeRange,
    level,
    workflowIds,
    folderIds,
    searchQuery,
    triggers,
    setPage,
    setHasMore,
    setLoading,
    setLogs,
    setError,
    buildQueryParams,
  ])

  const loadMoreLogs = useCallback(() => {
    if (!isFetchingMore && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      setIsFetchingMore(true)
      setTimeout(() => {
        fetchLogs(nextPage, true)
      }, 50)
    }
  }, [fetchLogs, isFetchingMore, hasMore, page, setPage, setIsFetchingMore])

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
  }, [
    logs,
    selectedLogIndex,
    isSidebarOpen,
    selectedLog,
    handleNavigateNext,
    handleNavigatePrev,
    setIsSidebarOpen,
  ])

  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      {/* Add the animation styles */}
      <style jsx global>
        {selectedRowAnimation}
      </style>

      <ControlBar />
      <div className='flex flex-1 overflow-hidden'>
        <Filters />
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Table container */}
          <div className='flex flex-1 flex-col overflow-hidden'>
            {/* Table with fixed layout */}
            <div className='w-full min-w-[800px]'>
              {/* Header */}
              <div className='px-4 py-4'>
                <div className='rounded-lg border border-border/30 bg-muted/30'>
                  <div className='grid grid-cols-[160px_100px_1fr_120px_100px_100px] gap-4 px-4 py-3'>
                    <div className='font-medium text-muted-foreground text-xs'>Time</div>
                    <div className='font-medium text-muted-foreground text-xs'>Status</div>
                    <div className='font-medium text-muted-foreground text-xs'>Workflow</div>
                    <div className='hidden font-medium text-muted-foreground text-xs lg:block'>
                      Trigger
                    </div>
                    <div className='hidden font-medium text-muted-foreground text-xs xl:block'>
                      Cost
                    </div>
                    <div className='font-medium text-muted-foreground text-xs'>Duration</div>
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
                <div className='space-y-1 px-4 pb-4'>
                  {logs.map((log) => {
                    const formattedDate = formatDate(log.createdAt)
                    const isSelected = selectedLog?.id === log.id

                    return (
                      <div
                        key={log.id}
                        ref={isSelected ? selectedRowRef : null}
                        className={`cursor-pointer rounded-lg border transition-all duration-200 ${
                          isSelected
                            ? 'border-primary bg-accent/40 shadow-sm'
                            : 'border-border hover:border-border/80 hover:bg-accent/20'
                        }`}
                        onClick={() => handleLogClick(log)}
                      >
                        <div className='grid grid-cols-[160px_100px_1fr_120px_100px_100px] gap-4 px-4 py-4'>
                          {/* Time */}
                          <div>
                            <div className='font-medium text-sm'>{formattedDate.formatted}</div>
                            <div className='text-muted-foreground text-xs'>
                              {formattedDate.relative}
                            </div>
                          </div>

                          {/* Status */}
                          <div>
                            <div
                              className={`inline-flex items-center justify-center rounded-md px-2 py-1 text-xs ${
                                log.level === 'error'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-green-100 text-green-800'
                              }`}
                            >
                              <span className='font-medium'>
                                {log.level === 'error' ? 'Failed' : 'Success'}
                              </span>
                            </div>
                          </div>

                          {/* Workflow */}
                          <div className='min-w-0'>
                            <div className='truncate font-medium text-sm'>
                              {log.workflow?.name || 'Unknown Workflow'}
                            </div>
                            <div className='truncate text-muted-foreground text-xs'>
                              {log.message}
                            </div>
                          </div>

                          {/* Trigger */}
                          <div className='hidden lg:block'>
                            <div className='text-muted-foreground text-xs'>
                              {log.trigger || '—'}
                            </div>
                          </div>

                          {/* Cost */}
                          <div className='hidden xl:block'>
                            <div className='text-muted-foreground text-xs'>
                              {log.metadata?.enhanced && log.metadata?.cost?.total ? (
                                <span>${log.metadata.cost.total.toFixed(4)}</span>
                              ) : (
                                <span className='pl-0.5'>—</span>
                              )}
                            </div>
                          </div>

                          {/* Duration */}
                          <div>
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
