'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { cn } from '@/lib/utils'
import Controls from '@/app/workspace/[workspaceId]/logs/components/dashboard/controls'
import { AutocompleteSearch } from '@/app/workspace/[workspaceId]/logs/components/search/search'
import { Sidebar } from '@/app/workspace/[workspaceId]/logs/components/sidebar/sidebar'
import ExecutionsDashboard from '@/app/workspace/[workspaceId]/logs/executions-dashboard'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils/format-date'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { LogsResponse, WorkflowLog } from '@/stores/logs/filters/types'

const logger = createLogger('Logs')
const LOGS_PER_PAGE = 50

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
    viewMode,
    setViewMode,
  } = useFilterStore()

  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId])

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isDetailsLoading, setIsDetailsLoading] = useState(false)
  const detailsCacheRef = useRef<Map<string, any>>(new Map())
  const detailsAbortRef = useRef<AbortController | null>(null)
  const currentDetailsIdRef = useRef<string | null>(null)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isInitialized = useRef<boolean>(false)

  const [searchQuery, setSearchQuery] = useState(storeSearchQuery)
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([])
  const [availableFolders, setAvailableFolders] = useState<string[]>([])

  // Live and refresh state
  const [isLive, setIsLive] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const liveIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isSearchOpenRef = useRef<boolean>(false)

  // Sync local search query with store search query
  useEffect(() => {
    setSearchQuery(storeSearchQuery)
  }, [storeSearchQuery])

  const { fetchFolders, getFolderTree } = useFolderStore()

  useEffect(() => {
    let cancelled = false

    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`)
        if (res.ok) {
          const body = await res.json()
          const names: string[] = Array.isArray(body?.data)
            ? body.data.map((w: any) => w?.name).filter(Boolean)
            : []
          if (!cancelled) setAvailableWorkflows(names)
        } else {
          if (!cancelled) setAvailableWorkflows([])
        }

        await fetchFolders(workspaceId)
        const tree = getFolderTree(workspaceId)

        const flatten = (nodes: any[], parentPath = ''): string[] => {
          const out: string[] = []
          for (const n of nodes) {
            const path = parentPath ? `${parentPath} / ${n.name}` : n.name
            out.push(path)
            if (n.children?.length) out.push(...flatten(n.children, path))
          }
          return out
        }

        const folderPaths: string[] = Array.isArray(tree) ? flatten(tree) : []
        if (!cancelled) setAvailableFolders(folderPaths)
      } catch {
        if (!cancelled) {
          setAvailableWorkflows([])
          setAvailableFolders([])
        }
      }
    }

    if (workspaceId) {
      fetchSuggestions()
    }

    return () => {
      cancelled = true
    }
  }, [workspaceId, fetchFolders, getFolderTree])

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
    setIsDetailsLoading(true)

    const currentId = log.id
    const prevId = index > 0 ? logs[index - 1]?.id : undefined
    const nextId = index < logs.length - 1 ? logs[index + 1]?.id : undefined

    if (detailsAbortRef.current) {
      try {
        detailsAbortRef.current.abort()
      } catch {
        /* no-op */
      }
    }
    const controller = new AbortController()
    detailsAbortRef.current = controller
    currentDetailsIdRef.current = currentId

    const idsToFetch: Array<{ id: string; merge: boolean }> = []
    const cachedCurrent = currentId ? detailsCacheRef.current.get(currentId) : undefined
    if (currentId && !cachedCurrent) idsToFetch.push({ id: currentId, merge: true })
    if (prevId && !detailsCacheRef.current.has(prevId))
      idsToFetch.push({ id: prevId, merge: false })
    if (nextId && !detailsCacheRef.current.has(nextId))
      idsToFetch.push({ id: nextId, merge: false })

    if (cachedCurrent) {
      setSelectedLog((prev) =>
        prev && prev.id === currentId
          ? ({ ...(prev as any), ...(cachedCurrent as any) } as any)
          : prev
      )
      setIsDetailsLoading(false)
    }
    if (idsToFetch.length === 0) return

    Promise.all(
      idsToFetch.map(async ({ id, merge }) => {
        try {
          const res = await fetch(`/api/logs/${id}`, { signal: controller.signal })
          if (!res.ok) return
          const body = await res.json()
          const detailed = body?.data
          if (detailed) {
            detailsCacheRef.current.set(id, detailed)
            if (merge && id === currentId) {
              setSelectedLog((prev) =>
                prev && prev.id === id ? ({ ...(prev as any), ...(detailed as any) } as any) : prev
              )
              if (currentDetailsIdRef.current === id) setIsDetailsLoading(false)
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
              const res = await fetch(`/api/logs/${id}`, { signal: controller.signal })
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
              const res = await fetch(`/api/logs/${id}`, { signal: controller.signal })
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
      // Don't fetch if workspaceId is not set
      const { workspaceId: storeWorkspaceId } = useFilterStore.getState()
      if (!storeWorkspaceId) {
        return
      }

      if (pageNum === 1) {
        setLoading(true)
      } else {
        setIsFetchingMore(true)
      }

      const { buildQueryParams: getCurrentQueryParams } = useFilterStore.getState()
      const queryParams = getCurrentQueryParams(pageNum, LOGS_PER_PAGE)

      const { searchQuery: currentSearchQuery } = useFilterStore.getState()
      const parsedQuery = parseQuery(currentSearchQuery)
      const enhancedParams = queryToApiParams(parsedQuery)

      const allParams = new URLSearchParams(queryParams)
      Object.entries(enhancedParams).forEach(([key, value]) => {
        if (key === 'triggers' && allParams.has('triggers')) {
          const existingTriggers = allParams.get('triggers')?.split(',') || []
          const searchTriggers = value.split(',')
          const combined = [...new Set([...existingTriggers, ...searchTriggers])]
          allParams.set('triggers', combined.join(','))
        } else {
          allParams.set(key, value)
        }
      })

      allParams.set('details', 'basic')
      const response = await fetch(`/api/logs?${allParams.toString()}`)

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

  const handleExport = async () => {
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
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [initializeFromURL])

  useEffect(() => {
    if (!isInitialized.current) {
      return
    }

    // Don't fetch if workspaceId is not set yet
    if (!workspaceId) {
      return
    }

    setPage(1)
    setHasMore(true)

    const fetchWithFilters = async () => {
      try {
        setLoading(true)

        const params = new URLSearchParams()
        params.set('details', 'basic')
        params.set('limit', LOGS_PER_PAGE.toString())
        params.set('offset', '0') // Always start from page 1
        params.set('workspaceId', workspaceId)

        const parsedQuery = parseQuery(debouncedSearchQuery)
        const enhancedParams = queryToApiParams(parsedQuery)

        if (level !== 'all') params.set('level', level)
        if (triggers.length > 0) params.set('triggers', triggers.join(','))
        if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
        if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))

        Object.entries(enhancedParams).forEach(([key, value]) => {
          if (key === 'triggers' && params.has('triggers')) {
            const storeTriggers = params.get('triggers')?.split(',') || []
            const searchTriggers = value.split(',')
            const combined = [...new Set([...storeTriggers, ...searchTriggers])]
            params.set('triggers', combined.join(','))
          } else {
            params.set(key, value)
          }
        })

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
  }, [workspaceId, timeRange, level, workflowIds, folderIds, debouncedSearchQuery, triggers])

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

  // If in dashboard mode, show the dashboard
  if (viewMode === 'dashboard') {
    return <ExecutionsDashboard />
  }

  return (
    <div className='flex h-full min-w-0 flex-col pl-64'>
      {/* Add the animation styles */}
      <style jsx global>
        {selectedRowAnimation}
      </style>

      <div className='flex min-w-0 flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto p-6'>
          <Controls
            isRefetching={isRefreshing}
            resetToNow={handleRefresh}
            live={isLive}
            setLive={(fn) => setIsLive(fn)}
            viewMode={viewMode as string}
            setViewMode={setViewMode as (mode: 'logs' | 'dashboard') => void}
            searchComponent={
              <AutocompleteSearch
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder='Search logs...'
                availableWorkflows={availableWorkflows}
                availableFolders={availableFolders}
                onOpenChange={(open) => {
                  isSearchOpenRef.current = open
                }}
              />
            }
            showExport={true}
            onExport={handleExport}
          />

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
