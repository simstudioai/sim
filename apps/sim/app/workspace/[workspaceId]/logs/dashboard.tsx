'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { soehne } from '@/app/fonts/soehne/soehne'
import Controls from '@/app/workspace/[workspaceId]/logs/components/dashboard/controls'
import KPIs from '@/app/workspace/[workspaceId]/logs/components/dashboard/kpis'
import WorkflowDetails from '@/app/workspace/[workspaceId]/logs/components/dashboard/workflow-details'
import WorkflowsList from '@/app/workspace/[workspaceId]/logs/components/dashboard/workflows-list'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/filters/components/timeline'
import { mapToExecutionLog, mapToExecutionLogAlt } from '@/app/workspace/[workspaceId]/logs/utils'
import {
  useExecutionsMetrics,
  useGlobalDashboardLogs,
  useWorkflowDashboardLogs,
} from '@/hooks/queries/logs'
import { formatCost } from '@/providers/utils'
import { useFilterStore } from '@/stores/logs/filters/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type TimeFilter = '30m' | '1h' | '6h' | '12h' | '24h' | '3d' | '7d' | '14d' | '30d'

interface WorkflowExecution {
  workflowId: string
  workflowName: string
  segments: {
    successRate: number // 0-100
    timestamp: string
    hasExecutions: boolean
    totalExecutions: number
    successfulExecutions: number
    avgDurationMs?: number
    p50Ms?: number
    p90Ms?: number
    p99Ms?: number
  }[]
  overallSuccessRate: number
}

const DEFAULT_SEGMENTS = 72
const MIN_SEGMENT_PX = 10

interface ExecutionLog {
  id: string
  executionId: string
  startedAt: string
  level: string
  trigger: string
  triggerUserId: string | null
  triggerInputs: any
  outputs: any
  errorMessage: string | null
  duration: number | null
  cost: {
    input: number
    output: number
    total: number
  } | null
  workflowName?: string
  workflowColor?: string
}

export default function Dashboard() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const router = useRouter()
  const searchParams = useSearchParams()

  const getTimeFilterFromRange = (range: string): TimeFilter => {
    switch (range) {
      case 'Past 30 minutes':
        return '30m'
      case 'Past hour':
        return '1h'
      case 'Past 6 hours':
        return '6h'
      case 'Past 12 hours':
        return '12h'
      case 'Past 24 hours':
        return '24h'
      case 'Past 3 days':
        return '3d'
      case 'Past 7 days':
        return '7d'
      case 'Past 14 days':
        return '14d'
      case 'Past 30 days':
        return '30d'
      default:
        return '30d'
    }
  }
  const [endTime, setEndTime] = useState<Date>(new Date())
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [selectedSegments, setSelectedSegments] = useState<Record<string, number[]>>({})
  const [lastAnchorIndices, setLastAnchorIndices] = useState<Record<string, number>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [segmentCount, setSegmentCount] = useState<number>(DEFAULT_SEGMENTS)
  const barsAreaRef = useRef<HTMLDivElement | null>(null)

  const {
    workflowIds,
    folderIds,
    triggers,
    viewMode,
    setViewMode,
    timeRange: sidebarTimeRange,
  } = useFilterStore()

  const { workflows } = useWorkflowRegistry()

  const timeFilter = getTimeFilterFromRange(sidebarTimeRange)

  const getStartTime = useCallback(() => {
    const start = new Date(endTime)

    switch (timeFilter) {
      case '30m':
        start.setMinutes(endTime.getMinutes() - 30)
        break
      case '1h':
        start.setHours(endTime.getHours() - 1)
        break
      case '6h':
        start.setHours(endTime.getHours() - 6)
        break
      case '12h':
        start.setHours(endTime.getHours() - 12)
        break
      case '24h':
        start.setHours(endTime.getHours() - 24)
        break
      case '3d':
        start.setDate(endTime.getDate() - 3)
        break
      case '7d':
        start.setDate(endTime.getDate() - 7)
        break
      case '14d':
        start.setDate(endTime.getDate() - 14)
        break
      case '30d':
        start.setDate(endTime.getDate() - 30)
        break
      default:
        start.setHours(endTime.getHours() - 24)
    }

    return start
  }, [endTime, timeFilter])

  const metricsFilters = useMemo(
    () => ({
      workspaceId,
      segments: segmentCount || DEFAULT_SEGMENTS,
      startTime: getStartTime().toISOString(),
      endTime: endTime.toISOString(),
      workflowIds: workflowIds.length > 0 ? workflowIds : undefined,
      folderIds: folderIds.length > 0 ? folderIds : undefined,
      triggers: triggers.length > 0 ? triggers : undefined,
    }),
    [workspaceId, segmentCount, getStartTime, endTime, workflowIds, folderIds, triggers]
  )

  const logsFilters = useMemo(
    () => ({
      workspaceId,
      startDate: getStartTime().toISOString(),
      endDate: endTime.toISOString(),
      workflowIds: workflowIds.length > 0 ? workflowIds : undefined,
      folderIds: folderIds.length > 0 ? folderIds : undefined,
      triggers: triggers.length > 0 ? triggers : undefined,
      limit: 50,
    }),
    [workspaceId, getStartTime, endTime, workflowIds, folderIds, triggers]
  )

  const metricsQuery = useExecutionsMetrics(metricsFilters, {
    enabled: Boolean(workspaceId),
  })

  const globalLogsQuery = useGlobalDashboardLogs(logsFilters, {
    enabled: Boolean(workspaceId),
  })

  const workflowLogsQuery = useWorkflowDashboardLogs(expandedWorkflowId ?? undefined, logsFilters, {
    enabled: Boolean(workspaceId) && Boolean(expandedWorkflowId),
  })

  const executions = metricsQuery.data?.workflows ?? []
  const aggregateSegments = metricsQuery.data?.aggregateSegments ?? []
  const loading = metricsQuery.isLoading
  const isRefetching = metricsQuery.isFetching && !metricsQuery.isLoading
  const error = metricsQuery.error?.message ?? null

  const globalLogs = useMemo(() => {
    if (!globalLogsQuery.data?.pages) return []
    return globalLogsQuery.data.pages.flatMap((page) => page.logs).map(mapToExecutionLog)
  }, [globalLogsQuery.data?.pages])

  const workflowLogs = useMemo(() => {
    if (!workflowLogsQuery.data?.pages) return []
    return workflowLogsQuery.data.pages.flatMap((page) => page.logs).map(mapToExecutionLogAlt)
  }, [workflowLogsQuery.data?.pages])

  const globalDetails = useMemo(() => {
    if (!aggregateSegments.length) return null

    const errorRates = aggregateSegments.map((s) => ({
      timestamp: s.timestamp,
      value: s.totalExecutions > 0 ? (1 - s.successfulExecutions / s.totalExecutions) * 100 : 0,
    }))

    const executionCounts = aggregateSegments.map((s) => ({
      timestamp: s.timestamp,
      value: s.totalExecutions,
    }))

    return {
      errorRates,
      durations: [],
      executionCounts,
      logs: globalLogs,
      allLogs: globalLogs,
    }
  }, [aggregateSegments, globalLogs])

  const workflowDetails = useMemo(() => {
    if (!expandedWorkflowId || !workflowLogs.length) return {}

    return {
      [expandedWorkflowId]: {
        errorRates: [],
        durations: [],
        executionCounts: [],
        logs: workflowLogs,
        allLogs: workflowLogs,
      },
    }
  }, [expandedWorkflowId, workflowLogs])

  useEffect(() => {
    const urlView = searchParams.get('view')
    if (urlView === 'dashboard' || urlView === 'logs') {
      if ((viewMode as string) !== urlView) setViewMode(urlView as any)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(Array.from(searchParams.entries()))
    if (!sp.get('view')) {
      sp.set('view', viewMode as string)
      router.replace(`${window.location.pathname}?${sp.toString()}`, { scroll: false })
      return
    }
    if (sp.get('view') !== (viewMode as string)) {
      sp.set('view', viewMode as string)
      router.replace(`${window.location.pathname}?${sp.toString()}`, { scroll: false })
    }
  }, [viewMode, router, searchParams])

  const filteredExecutions = searchQuery.trim()
    ? executions.filter((workflow) =>
        workflow.workflowName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : executions

  const aggregate = useMemo(() => {
    let totalExecutions = 0
    let successfulExecutions = 0
    let activeWorkflows = 0

    for (const wf of executions) {
      let workflowHasExecutions = false
      for (const seg of wf.segments) {
        totalExecutions += seg.totalExecutions || 0
        successfulExecutions += seg.successfulExecutions || 0
        if (seg.hasExecutions) workflowHasExecutions = true
      }
      if (workflowHasExecutions) activeWorkflows += 1
    }

    const failedExecutions = Math.max(totalExecutions - successfulExecutions, 0)
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 100

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      activeWorkflows,
      successRate,
    }
  }, [executions])

  const loadMoreLogs = useCallback(
    (workflowId: string) => {
      if (
        workflowId === expandedWorkflowId &&
        workflowLogsQuery.hasNextPage &&
        !workflowLogsQuery.isFetchingNextPage
      ) {
        workflowLogsQuery.fetchNextPage()
      }
    },
    [expandedWorkflowId, workflowLogsQuery]
  )

  const loadMoreGlobalLogs = useCallback(() => {
    if (globalLogsQuery.hasNextPage && !globalLogsQuery.isFetchingNextPage) {
      globalLogsQuery.fetchNextPage()
    }
  }, [globalLogsQuery])

  const toggleWorkflow = useCallback(
    (workflowId: string) => {
      if (expandedWorkflowId === workflowId) {
        setExpandedWorkflowId(null)
      } else {
        setExpandedWorkflowId(workflowId)
      }
    },
    [expandedWorkflowId]
  )

  const handleSegmentClick = useCallback(
    (
      workflowId: string,
      segmentIndex: number,
      _timestamp: string,
      mode: 'single' | 'toggle' | 'range'
    ) => {
      if (mode === 'toggle') {
        setSelectedSegments((prev) => {
          const currentSegments = prev[workflowId] || []
          const exists = currentSegments.includes(segmentIndex)
          const nextSegments = exists
            ? currentSegments.filter((i) => i !== segmentIndex)
            : [...currentSegments, segmentIndex].sort((a, b) => a - b)

          if (nextSegments.length === 0) {
            const { [workflowId]: _, ...rest } = prev
            if (Object.keys(rest).length === 0) {
              setExpandedWorkflowId(null)
            }
            return rest
          }

          const newState = { ...prev, [workflowId]: nextSegments }

          const selectedWorkflowIds = Object.keys(newState)
          if (selectedWorkflowIds.length > 1) {
            setExpandedWorkflowId('__multi__')
          } else if (selectedWorkflowIds.length === 1) {
            setExpandedWorkflowId(selectedWorkflowIds[0])
          }

          return newState
        })

        setLastAnchorIndices((prev) => ({ ...prev, [workflowId]: segmentIndex }))
      } else if (mode === 'single') {
        setSelectedSegments((prev) => {
          const currentSegments = prev[workflowId] || []
          const isOnlySelectedSegment =
            currentSegments.length === 1 && currentSegments[0] === segmentIndex
          const isOnlyWorkflowSelected = Object.keys(prev).length === 1 && prev[workflowId]

          if (isOnlySelectedSegment && isOnlyWorkflowSelected) {
            setExpandedWorkflowId(null)
            setLastAnchorIndices({})
            return {}
          }

          setExpandedWorkflowId(workflowId)
          setLastAnchorIndices({ [workflowId]: segmentIndex })
          return { [workflowId]: [segmentIndex] }
        })
      } else if (mode === 'range') {
        if (expandedWorkflowId === workflowId) {
          setSelectedSegments((prev) => {
            const currentSegments = prev[workflowId] || []
            const anchor = lastAnchorIndices[workflowId] ?? segmentIndex
            const [start, end] =
              anchor < segmentIndex ? [anchor, segmentIndex] : [segmentIndex, anchor]
            const range = Array.from({ length: end - start + 1 }, (_, i) => start + i)
            const union = new Set([...currentSegments, ...range])
            return { ...prev, [workflowId]: Array.from(union).sort((a, b) => a - b) }
          })
        } else {
          setExpandedWorkflowId(workflowId)
          setSelectedSegments({ [workflowId]: [segmentIndex] })
          setLastAnchorIndices({ [workflowId]: segmentIndex })
        }
      }
    },
    [expandedWorkflowId, workflowDetails, lastAnchorIndices]
  )

  useEffect(() => {
    setSelectedSegments({})
    setLastAnchorIndices({})
  }, [timeFilter, endTime, workflowIds, folderIds, triggers])

  useEffect(() => {
    if (!barsAreaRef.current) return
    const el = barsAreaRef.current
    let debounceId: any = null
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect?.width || 720
      const n = Math.max(36, Math.min(96, Math.floor(w / MIN_SEGMENT_PX)))
      if (debounceId) clearTimeout(debounceId)
      debounceId = setTimeout(() => {
        setSegmentCount(n)
      }, 150)
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    if (rect?.width) {
      const n = Math.max(36, Math.min(96, Math.floor(rect.width / MIN_SEGMENT_PX)))
      setSegmentCount(n)
    }
    return () => {
      if (debounceId) clearTimeout(debounceId)
      ro.disconnect()
    }
  }, [])

  const getDateRange = () => {
    const start = getStartTime()
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', year: 'numeric' })}`
  }

  const resetToNow = () => {
    setEndTime(new Date())
  }

  const [live, setLive] = useState(false)

  useEffect(() => {
    let interval: any
    if (live) {
      interval = setInterval(() => {
        resetToNow()
      }, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [live])

  return (
    <div className={`flex h-full min-w-0 flex-col pl-64 ${soehne.className}`}>
      <div className='flex min-w-0 flex-1 overflow-hidden'>
        <div
          className='flex flex-1 flex-col overflow-hidden p-6'
          style={{ scrollbarGutter: 'stable' }}
        >
          {/* Controls */}
          <Controls
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isRefetching={isRefetching}
            resetToNow={resetToNow}
            live={live}
            setLive={setLive}
            viewMode={viewMode as string}
            setViewMode={setViewMode as (mode: 'logs' | 'dashboard') => void}
          />

          {/* Content */}
          {loading ? (
            <div className='flex flex-1 items-center justify-center'>
              <div className='flex items-center gap-2 text-muted-foreground'>
                <Loader2 className='h-5 w-5 animate-spin' />
                <span>Loading execution history...</span>
              </div>
            </div>
          ) : error ? (
            <div className='flex flex-1 items-center justify-center'>
              <div className='text-destructive'>
                <p className='font-medium'>Error loading data</p>
                <p className='text-sm'>{error}</p>
              </div>
            </div>
          ) : executions.length === 0 ? (
            <div className='flex flex-1 items-center justify-center'>
              <div className='text-center text-muted-foreground'>
                <p className='font-medium'>No execution history</p>
                <p className='mt-1 text-sm'>Execute some workflows to see their history here</p>
              </div>
            </div>
          ) : (
            <>
              {/* Top section pinned */}
              <div className='sticky top-0 z-10 mb-1 bg-background pb-1'>
                {/* Time Range Display */}
                <div className='mb-3 flex items-center justify-between'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <span className='max-w-[40vw] truncate font-[500] text-muted-foreground text-sm'>
                      {getDateRange()}
                    </span>
                    {(workflowIds.length > 0 || folderIds.length > 0 || triggers.length > 0) && (
                      <div className='flex items-center gap-2 text-muted-foreground text-xs'>
                        <span>Filters:</span>
                        {workflowIds.length > 0 && (
                          <span className='inline-flex items-center rounded-[6px] bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                            {workflowIds.length} workflow{workflowIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {folderIds.length > 0 && (
                          <span className='inline-flex items-center rounded-[6px] bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                            {folderIds.length} folder{folderIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {triggers.length > 0 && (
                          <span className='inline-flex items-center rounded-[6px] bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                            {triggers.length} trigger{triggers.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Time Controls */}
                  <div className='flex items-center gap-2'>
                    <div className='mr-2 hidden sm:block'>
                      <Timeline variant='header' />
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                <KPIs aggregate={aggregate} />

                <div ref={barsAreaRef} className='mb-1'>
                  <WorkflowsList
                    executions={executions as any}
                    filteredExecutions={filteredExecutions as any}
                    expandedWorkflowId={expandedWorkflowId}
                    onToggleWorkflow={toggleWorkflow}
                    selectedSegments={selectedSegments}
                    onSegmentClick={handleSegmentClick}
                    searchQuery={searchQuery}
                    segmentDurationMs={
                      (endTime.getTime() - getStartTime().getTime()) / Math.max(1, segmentCount)
                    }
                  />
                </div>
              </div>

              {/* Details section in its own scroll area */}
              <div className='min-h-0 flex-1 overflow-auto'>
                {(() => {
                  if (expandedWorkflowId === '__multi__') {
                    const selectedWorkflowIds = Object.keys(selectedSegments)
                    const totalMs = endTime.getTime() - getStartTime().getTime()
                    const segMs = totalMs / Math.max(1, segmentCount)

                    const allSegmentIndices = new Set<number>()
                    for (const indices of Object.values(selectedSegments)) {
                      indices.forEach((idx) => allSegmentIndices.add(idx))
                    }
                    const sortedIndices = Array.from(allSegmentIndices).sort((a, b) => a - b)

                    const allLogs: any[] = []
                    let totalExecutions = 0
                    let totalSuccess = 0

                    const aggregatedSegments: Array<{
                      timestamp: string
                      totalExecutions: number
                      successfulExecutions: number
                      avgDurationMs: number
                      durationCount: number
                    }> = []

                    for (const idx of sortedIndices) {
                      let timestamp = ''
                      for (const wfId of selectedWorkflowIds) {
                        const wf = executions.find((w) => w.workflowId === wfId)
                        if (wf?.segments[idx]) {
                          timestamp = wf.segments[idx].timestamp
                          break
                        }
                      }

                      aggregatedSegments.push({
                        timestamp,
                        totalExecutions: 0,
                        successfulExecutions: 0,
                        avgDurationMs: 0,
                        durationCount: 0,
                      })
                    }

                    for (const wfId of selectedWorkflowIds) {
                      const wf = executions.find((w) => w.workflowId === wfId)
                      const details = workflowDetails[wfId]
                      const indices = selectedSegments[wfId] || []

                      if (!wf || !details || indices.length === 0) continue

                      const windows = indices
                        .map((idx) => wf.segments[idx])
                        .filter(Boolean)
                        .map((s) => {
                          const start = new Date(s.timestamp).getTime()
                          const end = start + segMs
                          totalExecutions += s.totalExecutions || 0
                          totalSuccess += s.successfulExecutions || 0
                          return { start, end }
                        })

                      const inAnyWindow = (t: number) =>
                        windows.some((w) => t >= w.start && t < w.end)

                      const workflowLogs = details.allLogs
                        .filter((log) => inAnyWindow(new Date(log.startedAt).getTime()))
                        .map((log) => ({
                          ...log,
                          workflowName: (log as any).workflowName || wf.workflowName,
                          workflowColor:
                            (log as any).workflowColor || workflows[wfId]?.color || '#64748b',
                        }))

                      allLogs.push(...workflowLogs)

                      indices.forEach((idx) => {
                        const segment = wf.segments[idx]
                        if (!segment) return

                        const aggIndex = sortedIndices.indexOf(idx)
                        if (aggIndex >= 0 && aggregatedSegments[aggIndex]) {
                          const agg = aggregatedSegments[aggIndex]
                          agg.totalExecutions += segment.totalExecutions || 0
                          agg.successfulExecutions += segment.successfulExecutions || 0
                          if (segment.avgDurationMs) {
                            agg.avgDurationMs += segment.avgDurationMs
                            agg.durationCount += 1
                          }
                        }
                      })
                    }

                    const errorRates = aggregatedSegments.map((seg) => ({
                      timestamp: seg.timestamp,
                      value:
                        seg.totalExecutions > 0
                          ? (1 - seg.successfulExecutions / seg.totalExecutions) * 100
                          : 0,
                    }))

                    const executionCounts = aggregatedSegments.map((seg) => ({
                      timestamp: seg.timestamp,
                      value: seg.totalExecutions,
                    }))

                    const durations = aggregatedSegments.map((seg) => ({
                      timestamp: seg.timestamp,
                      value: seg.durationCount > 0 ? seg.avgDurationMs / seg.durationCount : 0,
                    }))

                    allLogs.sort(
                      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
                    )

                    const totalFailures = Math.max(totalExecutions - totalSuccess, 0)
                    const totalRate =
                      totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 100

                    let multiWorkflowTimeRange: { start: Date; end: Date } | null = null
                    if (sortedIndices.length > 0) {
                      const firstIdx = sortedIndices[0]
                      const lastIdx = sortedIndices[sortedIndices.length - 1]

                      let earliestStart: Date | null = null
                      for (const wfId of selectedWorkflowIds) {
                        const wf = executions.find((w) => w.workflowId === wfId)
                        const segment = wf?.segments[firstIdx]
                        if (segment) {
                          const start = new Date(segment.timestamp)
                          if (!earliestStart || start < earliestStart) {
                            earliestStart = start
                          }
                        }
                      }

                      let latestEnd: Date | null = null
                      for (const wfId of selectedWorkflowIds) {
                        const wf = executions.find((w) => w.workflowId === wfId)
                        const segment = wf?.segments[lastIdx]
                        if (segment) {
                          const end = new Date(new Date(segment.timestamp).getTime() + segMs)
                          if (!latestEnd || end > latestEnd) {
                            latestEnd = end
                          }
                        }
                      }

                      if (earliestStart && latestEnd) {
                        multiWorkflowTimeRange = {
                          start: earliestStart,
                          end: latestEnd,
                        }
                      }
                    }

                    const workflowNames = selectedWorkflowIds
                      .map((id) => executions.find((w) => w.workflowId === id)?.workflowName)
                      .filter(Boolean) as string[]

                    return (
                      <WorkflowDetails
                        workspaceId={workspaceId}
                        expandedWorkflowId={'__multi__'}
                        workflowName={`${selectedWorkflowIds.length} workflows selected`}
                        overview={{
                          total: totalExecutions,
                          success: totalSuccess,
                          failures: totalFailures,
                          rate: totalRate,
                        }}
                        details={
                          {
                            errorRates,
                            durations,
                            executionCounts,
                            logs: allLogs,
                            allLogs: allLogs,
                          } as any
                        }
                        selectedSegmentIndex={sortedIndices}
                        selectedSegment={null}
                        selectedSegmentTimeRange={multiWorkflowTimeRange}
                        selectedWorkflowNames={workflowNames}
                        segmentDurationMs={segMs}
                        clearSegmentSelection={() => {
                          setSelectedSegments({})
                          setLastAnchorIndices({})
                          setExpandedWorkflowId(null)
                        }}
                        formatCost={formatCost}
                        onLoadMore={undefined}
                        hasMore={false}
                        isLoadingMore={false}
                      />
                    )
                  }

                  if (expandedWorkflowId) {
                    const wf = executions.find((w) => w.workflowId === expandedWorkflowId)
                    if (!wf) return null
                    const total = wf.segments.reduce((s, x) => s + (x.totalExecutions || 0), 0)
                    const success = wf.segments.reduce(
                      (s, x) => s + (x.successfulExecutions || 0),
                      0
                    )
                    const failures = Math.max(total - success, 0)
                    const rate = total > 0 ? (success / total) * 100 : 100

                    const details = workflowDetails[expandedWorkflowId]
                    let logsToDisplay = (details?.logs || []).map((log) => ({
                      ...log,
                      workflowName: (log as any).workflowName || wf.workflowName,
                    }))
                    // Helper to construct series from workflow segments
                    const buildSeriesFromSegments = (
                      segs: WorkflowExecution['segments']
                    ): {
                      errorRates: { timestamp: string; value: number }[]
                      executionCounts: { timestamp: string; value: number }[]
                      durations: { timestamp: string; value: number }[]
                      durationP50?: { timestamp: string; value: number }[]
                      durationP90?: { timestamp: string; value: number }[]
                      durationP99?: { timestamp: string; value: number }[]
                    } => {
                      const errorRates = segs.map((s) => ({
                        timestamp: s.timestamp,
                        value:
                          s.totalExecutions > 0
                            ? 100 -
                              Math.min(
                                100,
                                Math.max(
                                  0,
                                  (s.successfulExecutions / Math.max(1, s.totalExecutions)) * 100
                                )
                              )
                            : 0,
                      }))
                      const executionCounts = segs.map((s) => ({
                        timestamp: s.timestamp,
                        value: s.totalExecutions || 0,
                      }))
                      const durations = segs.map((s) => ({
                        timestamp: s.timestamp,
                        value: typeof s.avgDurationMs === 'number' ? s.avgDurationMs : 0,
                      }))
                      const durationP50 = segs.map((s) => ({
                        timestamp: s.timestamp,
                        value: typeof s.p50Ms === 'number' ? s.p50Ms : 0,
                      }))
                      const durationP90 = segs.map((s) => ({
                        timestamp: s.timestamp,
                        value: typeof s.p90Ms === 'number' ? s.p90Ms : 0,
                      }))
                      const durationP99 = segs.map((s) => ({
                        timestamp: s.timestamp,
                        value: typeof s.p99Ms === 'number' ? s.p99Ms : 0,
                      }))
                      return {
                        errorRates,
                        executionCounts,
                        durations,
                        durationP50,
                        durationP90,
                        durationP99,
                      }
                    }

                    const workflowSelectedIndices = selectedSegments[expandedWorkflowId] || []
                    if (details && workflowSelectedIndices.length > 0) {
                      const totalMs = endTime.getTime() - getStartTime().getTime()
                      const segMs = totalMs / Math.max(1, segmentCount)

                      const windows = workflowSelectedIndices
                        .map((idx) => wf.segments[idx])
                        .filter(Boolean)
                        .map((s) => {
                          const start = new Date(s.timestamp).getTime()
                          const end = start + segMs
                          return { start, end }
                        })

                      const inAnyWindow = (t: number) =>
                        windows.some((w) => t >= w.start && t < w.end)

                      logsToDisplay = details.allLogs
                        .filter((log) => inAnyWindow(new Date(log.startedAt).getTime()))
                        .map((log) => ({
                          ...log,
                          workflowName: (log as any).workflowName || wf.workflowName,
                        }))
                    }

                    // Compute series data based on selected segments or all segments
                    const segmentsToUse =
                      workflowSelectedIndices.length > 0
                        ? wf.segments.filter((_, i) => workflowSelectedIndices.includes(i))
                        : wf.segments
                    const series = buildSeriesFromSegments(segmentsToUse as any)

                    const detailsWithFilteredLogs = details
                      ? {
                          ...details,
                          logs: logsToDisplay,
                          errorRates: series.errorRates,
                          durations: series.durations,
                          executionCounts: series.executionCounts,
                          durationP50: series.durationP50,
                          durationP90: series.durationP90,
                          durationP99: series.durationP99,
                        }
                      : undefined

                    const selectedSegment =
                      workflowSelectedIndices.length === 1
                        ? wf.segments[workflowSelectedIndices[0]]
                        : null

                    // Calculate time range for selected segments
                    const segMs =
                      (endTime.getTime() - getStartTime().getTime()) / Math.max(1, segmentCount)
                    const selectedSegmentsData = workflowSelectedIndices
                      .map((idx) => wf.segments[idx])
                      .filter(Boolean)
                    const timeRange =
                      selectedSegmentsData.length > 0
                        ? (() => {
                            const sortedIndices = [...workflowSelectedIndices].sort((a, b) => a - b)
                            const firstSegment = wf.segments[sortedIndices[0]]
                            const lastSegment = wf.segments[sortedIndices[sortedIndices.length - 1]]
                            if (!firstSegment || !lastSegment) return null
                            const rangeStart = new Date(firstSegment.timestamp)
                            const rangeEnd = new Date(lastSegment.timestamp).getTime() + segMs
                            return {
                              start: rangeStart,
                              end: new Date(rangeEnd),
                            }
                          })()
                        : null

                    return (
                      <WorkflowDetails
                        workspaceId={workspaceId}
                        expandedWorkflowId={expandedWorkflowId}
                        workflowName={wf.workflowName}
                        overview={{ total, success, failures, rate }}
                        details={detailsWithFilteredLogs as any}
                        selectedSegmentIndex={workflowSelectedIndices}
                        selectedSegment={
                          selectedSegment
                            ? {
                                timestamp: selectedSegment.timestamp,
                                totalExecutions: selectedSegment.totalExecutions,
                              }
                            : null
                        }
                        selectedSegmentTimeRange={timeRange}
                        selectedWorkflowNames={undefined}
                        segmentDurationMs={segMs}
                        clearSegmentSelection={() => {
                          setSelectedSegments({})
                          setLastAnchorIndices({})
                        }}
                        formatCost={formatCost}
                        onLoadMore={() => loadMoreLogs(expandedWorkflowId)}
                        hasMore={workflowLogsQuery.hasNextPage ?? false}
                        isLoadingMore={workflowLogsQuery.isFetchingNextPage}
                      />
                    )
                  }

                  if (!globalDetails) return null
                  const totals = aggregateSegments.reduce(
                    (acc, s) => {
                      acc.total += s.totalExecutions
                      acc.success += s.successfulExecutions
                      return acc
                    },
                    { total: 0, success: 0 }
                  )
                  const failures = Math.max(totals.total - totals.success, 0)
                  const rate = totals.total > 0 ? (totals.success / totals.total) * 100 : 100

                  return (
                    <WorkflowDetails
                      workspaceId={workspaceId}
                      expandedWorkflowId={'all'}
                      workflowName={'All workflows'}
                      overview={{ total: totals.total, success: totals.success, failures, rate }}
                      details={globalDetails as any}
                      selectedSegmentIndex={[]}
                      selectedSegment={null}
                      selectedSegmentTimeRange={null}
                      selectedWorkflowNames={undefined}
                      segmentDurationMs={undefined}
                      clearSegmentSelection={() => {
                        setSelectedSegments({})
                        setLastAnchorIndices({})
                      }}
                      formatCost={formatCost}
                      onLoadMore={loadMoreGlobalLogs}
                      hasMore={globalLogsQuery.hasNextPage ?? false}
                      isLoadingMore={globalLogsQuery.isFetchingNextPage}
                    />
                  )
                })()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
