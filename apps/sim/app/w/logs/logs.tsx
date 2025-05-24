'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'
import { useSidebarStore } from '@/stores/sidebar/store'
import { ControlBar } from './components/control-bar/control-bar'
import { Filters } from './components/filters/filters'
import { Sidebar } from './components/sidebar/sidebar'
import { useFilterStore } from './stores/store'
import { LogsResponse, WorkflowLog } from './stores/types'
import { formatDate } from './utils/format-date'

const logger = createLogger('Logs')
const LOGS_PER_PAGE = 50

const getLevelBadgeStyles = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return 'bg-destructive/20 text-destructive error-badge'
    case 'warn':
      return 'bg-warning/20 text-warning'
    default:
      return 'bg-secondary text-secondary-foreground'
  }
}

const getTriggerBadgeStyles = (trigger: string) => {
  switch (trigger.toLowerCase()) {
    case 'manual':
      return 'bg-secondary text-secondary-foreground'
    case 'api':
      return 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
    case 'webhook':
      return 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400'
    case 'schedule':
      return 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
    case 'chat':
      return 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400'
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
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
  const {
    filteredLogs,
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
  } = useFilterStore()

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const executionGroups = useMemo(() => {
    const groups: Record<string, WorkflowLog[]> = {}

    // Group logs by executionId
    filteredLogs.forEach((log) => {
      if (log.executionId) {
        if (!groups[log.executionId]) {
          groups[log.executionId] = []
        }
        groups[log.executionId].push(log)
      }
    })

    Object.keys(groups).forEach((executionId) => {
      groups[executionId].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    })

    return groups
  }, [filteredLogs])

  const handleLogClick = (log: WorkflowLog) => {
    setSelectedLog(log)
    const index = filteredLogs.findIndex((l) => l.id === log.id)
    setSelectedLogIndex(index)
    setIsSidebarOpen(true)
  }

  const handleNavigateNext = () => {
    if (selectedLogIndex < filteredLogs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      setSelectedLog(filteredLogs[nextIndex])
    }
  }

  const handleNavigatePrev = () => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      setSelectedLog(filteredLogs[prevIndex])
    }
  }

  const handleCloseSidebar = () => {
    setIsSidebarOpen(false)
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
    async (pageNum: number, append: boolean = false) => {
      try {
        if (pageNum === 1) {
          setLoading(true)
        } else {
          setIsFetchingMore(true)
        }

        const response = await fetch(
          `/api/logs?includeWorkflow=true&limit=${LOGS_PER_PAGE}&offset=${(pageNum - 1) * LOGS_PER_PAGE}`
        )

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
    [setLogs, setLoading, setError, setHasMore, setIsFetchingMore]
  )

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
    fetchLogs(1)
  }, [fetchLogs])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredLogs.length === 0) return

      if (selectedLogIndex === -1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        setSelectedLogIndex(0)
        setSelectedLog(filteredLogs[0])
        return
      }

      if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && selectedLogIndex > 0) {
        e.preventDefault()
        handleNavigatePrev()
      }

      if (
        e.key === 'ArrowDown' &&
        !e.metaKey &&
        !e.ctrlKey &&
        selectedLogIndex < filteredLogs.length - 1
      ) {
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
    filteredLogs,
    selectedLogIndex,
    isSidebarOpen,
    selectedLog,
    handleNavigateNext,
    handleNavigatePrev,
    setIsSidebarOpen,
  ])

  return (
    <div
      className={`flex flex-col h-[100vh] transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      {/* Add the animation styles */}
      <style jsx global>
        {selectedRowAnimation}
      </style>

      <ControlBar />
      <div className="flex flex-1 overflow-hidden">
        <Filters />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Table container */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Table header - fixed */}
            <div className="border-b bg-background z-10 sticky top-0">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className={`${isSidebarCollapsed ? 'w-[16%]' : 'w-[19%]'}`} />
                  <col className="w-[8%] md:w-[7%]" />
                  <col className="w-[12%] md:w-[10%]" />
                  <col className="w-[8%] hidden lg:table-column" />
                  <col className="w-[8%] hidden lg:table-column" />
                  <col
                    className={`${isSidebarCollapsed ? 'w-auto md:w-[53%] lg:w-auto' : 'w-auto md:w-[50%] lg:w-auto'}`}
                  />
                  <col className="w-[8%] md:w-[10%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Time</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Status</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Workflow</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground leading-none">id</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground leading-none">Trigger</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Message</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Duration</span>
                    </th>
                  </tr>
                </thead>
              </table>
            </div>

            {/* Table body - scrollable */}
            <div className="flex-1 overflow-auto" ref={scrollContainerRef}>
              {loading && page === 1 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Loading logs...</span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    <span className="text-sm">Error: {error}</span>
                  </div>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Info className="h-5 w-5" />
                    <span className="text-sm">No logs found</span>
                  </div>
                </div>
              ) : (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className={`${isSidebarCollapsed ? 'w-[16%]' : 'w-[19%]'}`} />
                    <col className="w-[8%] md:w-[7%]" />
                    <col className="w-[12%] md:w-[10%]" />
                    <col className="w-[8%] hidden lg:table-column" />
                    <col className="w-[8%] hidden lg:table-column" />
                    <col
                      className={`${isSidebarCollapsed ? 'w-auto md:w-[53%] lg:w-auto' : 'w-auto md:w-[50%] lg:w-auto'}`}
                    />
                    <col className="w-[8%] md:w-[10%]" />
                  </colgroup>
                  <tbody>
                    {filteredLogs.map((log) => {
                      const formattedDate = formatDate(log.createdAt)
                      const isSelected = selectedLog?.id === log.id
                      const isWorkflowExecutionLog =
                        log.executionId && executionGroups[log.executionId].length === 1

                      return (
                        <tr
                          key={log.id}
                          ref={isSelected ? selectedRowRef : null}
                          className={`border-b transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-accent/40 hover:bg-accent/50 border-l-2 selected-row'
                              : 'hover:bg-accent/30'
                          }`}
                          onClick={() => handleLogClick(log)}
                        >
                          {/* Time column */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col justify-center">
                              <div className="text-xs font-medium flex items-center">
                                <span>{formattedDate.formatted}</span>
                                <span className="mx-1.5 text-muted-foreground hidden xl:inline">
                                  •
                                </span>
                                <span className="text-muted-foreground hidden xl:inline">
                                  {new Date(log.createdAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                <span>{formattedDate.relative}</span>
                              </div>
                            </div>
                          </td>

                          {/* Level column */}
                          <td className="px-4 py-3">
                            <div
                              className={`inline-flex items-center justify-center px-2 py-1 text-xs rounded-md ${getLevelBadgeStyles(log.level)}`}
                            >
                              <span className="font-medium">{log.level}</span>
                            </div>
                          </td>

                          {/* Workflow column */}
                          <td className="px-4 py-3">
                            {log.workflow && (
                              <div
                                className="inline-flex items-center px-2 py-1 text-xs rounded-md truncate max-w-full"
                                style={{
                                  backgroundColor: `${log.workflow.color}20`,
                                  color: log.workflow.color,
                                }}
                                title={log.workflow.name}
                              >
                                <span className="font-medium truncate">{log.workflow.name}</span>
                              </div>
                            )}
                          </td>

                          {/* ID column - hidden on small screens */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <div className="text-xs font-mono text-muted-foreground">
                              {log.executionId ? `#${log.executionId.substring(0, 4)}` : '—'}
                            </div>
                          </td>

                          {/* Trigger column - hidden on medium screens and below */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {log.trigger && (
                              <div
                                className={`inline-flex items-center px-2 py-1 text-xs rounded-md ${getTriggerBadgeStyles(log.trigger)}`}
                              >
                                <span className="font-medium">{log.trigger}</span>
                              </div>
                            )}
                          </td>

                          {/* Message column */}
                          <td className="px-4 py-3">
                            <div className="text-sm truncate" title={log.message}>
                              {log.message}
                            </div>
                          </td>

                          {/* Duration column */}
                          <td className="px-4 py-3">
                            <div className="text-xs text-muted-foreground">
                              {log.duration || '—'}
                            </div>
                          </td>
                        </tr>
                      )
                    })}

                    {/* Infinite scroll loader */}
                    {hasMore && (
                      <tr>
                        <td colSpan={7}>
                          <div
                            ref={loaderRef}
                            className="py-2 flex items-center justify-center"
                            style={{ height: '50px' }}
                          >
                            {isFetchingMore && (
                              <div className="flex items-center gap-2 text-muted-foreground opacity-70">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-xs">Loading more logs...</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Footer status indicator - useful for development */}
                    <tr className="border-t">
                      <td colSpan={7}>
                        <div className="py-2 px-4 text-xs text-muted-foreground flex justify-between items-center">
                          <span>Showing {filteredLogs.length} logs</span>
                          <div className="flex items-center gap-4">
                            {isFetchingMore ? (
                              <div className="flex items-center gap-2"></div>
                            ) : hasMore ? (
                              <button
                                type="button"
                                onClick={loadMoreLogs}
                                className="text-xs text-primary hover:underline"
                              >
                                Load more logs
                              </button>
                            ) : (
                              <span>End of logs</span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
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
        hasNext={selectedLogIndex < filteredLogs.length - 1}
        hasPrev={selectedLogIndex > 0}
      />
    </div>
  )
}
