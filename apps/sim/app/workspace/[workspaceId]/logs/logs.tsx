'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, Bell, Loader2, RefreshCw, Upload } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Badge, Button, buttonVariants, Library, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getIntegrationMetadata } from '@/lib/logs/get-trigger-options'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import {
  AutocompleteSearch,
  Dashboard,
  LogDetails,
  LogsFilter,
  NotificationSettings,
} from '@/app/workspace/[workspaceId]/logs/components'
import { formatDate, formatDuration } from '@/app/workspace/[workspaceId]/logs/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks/registry'
import { useFolders } from '@/hooks/queries/folders'
import { useLogDetail, useLogsList } from '@/hooks/queries/logs'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'

const LOGS_PER_PAGE = 50
const REFRESH_SPINNER_DURATION_MS = 1000

/**
 * Checks if a hex color is gray/neutral (low saturation) or too light/dark
 */
function isGrayOrNeutral(hex: string): boolean {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2 / 255

  // Calculate saturation
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)) / 255

  // Gray if low saturation, or too light (>0.8) or too dark (<0.25)
  return saturation < 0.2 || lightness > 0.8 || lightness < 0.25
}

/**
 * Converts a hex color to a background variant with appropriate opacity
 */
function hexToBackground(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.2)`
}

/**
 * Lightens a hex color to make it more vibrant for text
 */
function lightenColor(hex: string, percent = 30): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)

  const newR = Math.min(255, Math.round(r + (255 - r) * (percent / 100)))
  const newG = Math.min(255, Math.round(g + (255 - g) * (percent / 100)))
  const newB = Math.min(255, Math.round(b + (255 - b) * (percent / 100)))

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}

const CORE_TRIGGER_TYPES = ['manual', 'api', 'schedule', 'chat', 'webhook']

const TriggerBadge = React.memo(({ trigger }: { trigger: string }) => {
  const metadata = getIntegrationMetadata(trigger)
  const isIntegration = !CORE_TRIGGER_TYPES.includes(trigger)
  const block = isIntegration ? getBlock(trigger) : null
  const IconComponent = block?.icon

  // Use default Badge for manual, generic, unknown integrations (no block), or gray/neutral colors
  const isUnknownIntegration = isIntegration && trigger !== 'generic' && !block
  if (
    trigger === 'manual' ||
    trigger === 'generic' ||
    isUnknownIntegration ||
    isGrayOrNeutral(metadata.color)
  ) {
    return (
      <Badge
        variant='default'
        className='inline-flex items-center gap-[6px] rounded-[6px] px-[9px] py-[2px] font-medium text-[12px]'
      >
        {IconComponent && <IconComponent className='h-[12px] w-[12px]' />}
        {metadata.label}
      </Badge>
    )
  }

  const textColor = lightenColor(metadata.color, 65)

  return (
    <div
      className='inline-flex items-center gap-[6px] rounded-[6px] px-[9px] py-[2px] font-medium text-[12px]'
      style={{ backgroundColor: hexToBackground(metadata.color), color: textColor }}
    >
      {IconComponent && <IconComponent className='h-[12px] w-[12px]' />}
      {metadata.label}
    </div>
  )
})

TriggerBadge.displayName = 'TriggerBadge'

const RUNNING_COLOR = '#22c55e'
const PENDING_COLOR = '#f59e0b'

const StatusBadge = React.memo(
  ({ status }: { status: 'error' | 'pending' | 'running' | 'info' }) => {
    const config = {
      error: {
        bg: 'var(--terminal-status-error-bg)',
        color: 'var(--text-error)',
        label: 'Error',
      },
      pending: {
        bg: hexToBackground(PENDING_COLOR),
        color: lightenColor(PENDING_COLOR, 65),
        label: 'Pending',
      },
      running: {
        bg: hexToBackground(RUNNING_COLOR),
        color: lightenColor(RUNNING_COLOR, 65),
        label: 'Running',
      },
      info: {
        bg: 'var(--terminal-status-info-bg)',
        color: 'var(--terminal-status-info-color)',
        label: 'Info',
      },
    }[status]

    return (
      <div
        className='inline-flex items-center gap-[6px] rounded-[6px] px-[9px] py-[2px] font-medium text-[12px]'
        style={{ backgroundColor: config.bg, color: config.color }}
      >
        <div className='h-[6px] w-[6px] rounded-[2px]' style={{ backgroundColor: config.color }} />
        {config.label}
      </div>
    )
  }
)

StatusBadge.displayName = 'StatusBadge'

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
  }, [workspaceId])

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
  }, [])

  const [, setAvailableWorkflows] = useState<string[]>([])
  const [, setAvailableFolders] = useState<string[]>([])

  const [isLive, setIsLive] = useState(false)
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
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

  const foldersQuery = useFolders(workspaceId)
  const { getFolderTree } = useFolderStore()

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
  }, [workspaceId, getFolderTree, foldersQuery.data])

  useEffect(() => {
    if (isInitialized.current) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, setStoreSearchQuery])

  const handleLogClick = (log: WorkflowLog) => {
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

  if (viewMode === 'dashboard') {
    return <Dashboard />
  }

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
          {/* Header with icon and title */}
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#7A5F11] bg-[#514215]'>
                <Library className='h-[14px] w-[14px] text-[#FBBC04]' />
              </div>
              <h1 className='font-medium text-[18px]'>Logs</h1>
            </div>
            <p className='mt-[10px] font-base text-[#888888] text-[14px]'>
              Shows the history of all workflow runs in your workspace.
            </p>
          </div>

          {/* Search and controls row */}
          <div className='mt-[14px] flex items-center justify-between'>
            <AutocompleteSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder='Search'
              onOpenChange={(open: boolean) => {
                isSearchOpenRef.current = open
              }}
            />
            <div className='flex items-center gap-[8px]'>
              {/* Export button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='default'
                    className='h-[32px] w-[32px] rounded-[6px] p-0'
                    onClick={handleExport}
                  >
                    <Upload className='h-[14px] w-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Export as CSV</Tooltip.Content>
              </Tooltip.Root>

              {/* Notification Settings button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='default'
                    className='h-[32px] w-[32px] rounded-[6px] p-0'
                    onClick={() => setIsNotificationSettingsOpen(true)}
                  >
                    <Bell className='h-[14px] w-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Notification Settings</Tooltip.Content>
              </Tooltip.Root>

              {/* Refresh button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='default'
                    className={cn(
                      'h-[32px] w-[32px] rounded-[6px] p-0',
                      isVisuallyRefreshing && 'opacity-50'
                    )}
                    onClick={isVisuallyRefreshing ? undefined : handleRefresh}
                  >
                    {isVisuallyRefreshing ? (
                      <Loader2 className='h-[14px] w-[14px] animate-spin' />
                    ) : (
                      <RefreshCw className='h-[14px] w-[14px]' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {isVisuallyRefreshing ? 'Refreshing...' : 'Refresh'}
                </Tooltip.Content>
              </Tooltip.Root>

              {/* Live button */}
              <Button
                variant={isLive ? 'primary' : 'default'}
                onClick={handleToggleLive}
                className='h-[32px] rounded-[6px] px-[10px]'
              >
                Live
              </Button>

              {/* View mode toggle */}
              <div className='flex h-[32px] items-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-elevated)] p-[2px]'>
                <Button
                  variant={(viewMode as string) !== 'dashboard' ? 'active' : 'ghost'}
                  onClick={() => setViewMode('logs')}
                  className='h-[26px] rounded-[4px] px-[10px] text-[13px]'
                >
                  Logs
                </Button>
                <Button
                  variant={(viewMode as string) === 'dashboard' ? 'active' : 'ghost'}
                  onClick={() => setViewMode('dashboard')}
                  className='h-[26px] rounded-[4px] px-[10px] text-[13px]'
                >
                  Dashboard
                </Button>
              </div>
            </div>
          </div>

          {/* Main content area with sidebar and table */}
          <div className='mt-[24px] flex min-h-0 flex-1 gap-[16px] overflow-hidden'>
            {/* Filter sidebar */}
            <LogsFilter searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

            {/* Table container - #202020 base */}
            <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] bg-[#202020]'>
              {/* Table header - #242424 */}
              <div className='flex-shrink-0 rounded-t-[6px] bg-[#242424] px-[24px] py-[10px]'>
                <div className='flex items-center'>
                  <span className='w-[14%] min-w-[110px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Date
                  </span>
                  <span className='w-[12%] min-w-[100px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Time
                  </span>
                  <span className='w-[12%] min-w-[100px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Status
                  </span>
                  <span className='w-[20%] min-w-[140px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Workflow
                  </span>
                  <span className='w-[12%] min-w-[90px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Cost
                  </span>
                  <span className='w-[14%] min-w-[110px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                    Trigger
                  </span>
                  <span className='w-[16%] min-w-[100px] font-medium text-[12px] text-[var(--text-tertiary)]'>
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
                            'relative flex h-[44px] cursor-pointer items-center px-[24px] hover:bg-[#292929]',
                            isSelected && 'bg-[#292929]'
                          )}
                          onClick={() => handleLogClick(log)}
                        >
                          <div className='flex flex-1 items-center'>
                            {/* Date */}
                            <span className='w-[14%] min-w-[110px] font-medium text-[12px] text-[var(--text-primary)]'>
                              {formattedDate.compactDate}
                            </span>

                            {/* Time */}
                            <span className='w-[12%] min-w-[100px] font-medium text-[12px] text-[var(--text-primary)]'>
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
                            <div className='flex w-[20%] min-w-[140px] items-center gap-[8px] pr-[8px]'>
                              <div
                                className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]'
                                style={{ backgroundColor: log.workflow?.color }}
                              />
                              <span className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                                {log.workflow?.name || 'Unknown'}
                              </span>
                            </div>

                            {/* Cost */}
                            <span className='w-[12%] min-w-[90px] font-medium text-[12px] text-[var(--text-primary)]'>
                              {typeof (log as any)?.cost?.total === 'number'
                                ? `$${((log as any).cost.total as number).toFixed(4)}`
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
                            <div className='w-[16%] min-w-[100px]'>
                              <Badge
                                variant='default'
                                className='rounded-[6px] px-[9px] py-[2px] text-[12px]'
                              >
                                {formatDuration(log.duration) || '—'}
                              </Badge>
                            </div>
                          </div>

                          {/* Resume Link */}
                          {isPending && log.executionId && (log.workflow?.id || log.workflowId) && (
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
          </div>
        </div>
      </div>

      {/* Log Details */}
      <LogDetails
        log={logDetailQuery.data || selectedLog}
        isOpen={isSidebarOpen}
        isLoadingDetails={logDetailQuery.isLoading}
        onClose={handleCloseSidebar}
        onNavigateNext={handleNavigateNext}
        onNavigatePrev={handleNavigatePrev}
        hasNext={selectedLogIndex < logs.length - 1}
        hasPrev={selectedLogIndex > 0}
      />

      <NotificationSettings
        workspaceId={workspaceId}
        open={isNotificationSettingsOpen}
        onOpenChange={setIsNotificationSettingsOpen}
      />
    </div>
  )
}
