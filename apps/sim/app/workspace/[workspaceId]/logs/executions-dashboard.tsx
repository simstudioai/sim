'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { soehne } from '@/app/fonts/soehne/soehne'
import Controls from '@/app/workspace/[workspaceId]/logs/components/dashboard/controls'
import KPIs from '@/app/workspace/[workspaceId]/logs/components/dashboard/kpis'
import WorkflowDetails from '@/app/workspace/[workspaceId]/logs/components/dashboard/workflow-details'
import WorkflowsList from '@/app/workspace/[workspaceId]/logs/components/dashboard/workflows-list'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/filters/components/timeline'
import { formatCost } from '@/providers/utils'
import { useFilterStore } from '@/stores/logs/filters/store'

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

interface WorkflowDetailsDataLocal {
  errorRates: { timestamp: string; value: number }[]
  durations: { timestamp: string; value: number }[]
  executionCounts: { timestamp: string; value: number }[]
  logs: ExecutionLog[]
  allLogs: ExecutionLog[] // Unfiltered logs for time filtering
}

export default function ExecutionsDashboard() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

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
        return '30d' // Treat "All time" as last 30 days to keep UI performant
    }
  }
  const [endTime, setEndTime] = useState<Date>(new Date())
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefetching, setIsRefetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowDetailsDataLocal>>(
    {}
  )
  const [globalDetails, setGlobalDetails] = useState<WorkflowDetailsDataLocal | null>(null)
  const [aggregateSegments, setAggregateSegments] = useState<
    { timestamp: string; totalExecutions: number; successfulExecutions: number }[]
  >([])
  const [selectedSegmentIndices, setSelectedSegmentIndices] = useState<number[]>([])
  const [lastAnchorIndex, setLastAnchorIndex] = useState<number | null>(null)
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

  const timeFilter = getTimeFilterFromRange(sidebarTimeRange)

  // Build lightweight chart series from a set of logs for a given window
  const buildSeriesFromLogs = (
    logs: ExecutionLog[],
    start: Date,
    end: Date,
    bins = 10
  ): {
    errorRates: { timestamp: string; value: number }[]
    executionCounts: { timestamp: string; value: number }[]
    durations: { timestamp: string; value: number }[]
  } => {
    const startMs = start.getTime()
    const totalMs = Math.max(1, end.getTime() - startMs)
    const binMs = Math.max(1, Math.floor(totalMs / Math.max(1, bins)))

    const errorRates: { timestamp: string; value: number }[] = []
    const executionCounts: { timestamp: string; value: number }[] = []
    const durations: { timestamp: string; value: number }[] = []

    for (let i = 0; i < bins; i++) {
      const bStart = startMs + i * binMs
      const bEnd = bStart + binMs
      const binLogs = logs.filter((l) => {
        const t = new Date(l.startedAt).getTime()
        return t >= bStart && t < bEnd
      })
      const total = binLogs.length
      const errors = binLogs.filter((l) => (l.level || '').toLowerCase() === 'error').length
      const avgDuration =
        total > 0
          ? Math.round(
              binLogs.reduce((s, l) => s + (typeof l.duration === 'number' ? l.duration : 0), 0) /
                total
            )
          : 0
      const ts = new Date(bStart).toISOString()
      errorRates.push({ timestamp: ts, value: total > 0 ? (1 - errors / total) * 100 : 100 })
      executionCounts.push({ timestamp: ts, value: total })
      durations.push({ timestamp: ts, value: avgDuration })
    }

    return { errorRates, executionCounts, durations }
  }

  // Filter executions based on search query
  const filteredExecutions = searchQuery.trim()
    ? executions.filter((workflow) =>
        workflow.workflowName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : executions

  // Aggregate metrics across workflows for header KPIs
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

  const fetchExecutions = useCallback(
    async (isInitialLoad = false) => {
      try {
        if (isInitialLoad) {
          setLoading(true)
        } else {
          setIsRefetching(true)
        }
        setError(null)

        const startTime = getStartTime()
        const params = new URLSearchParams({
          segments: String(segmentCount || DEFAULT_SEGMENTS),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        })

        // Add workflow filters if any
        if (workflowIds.length > 0) {
          params.set('workflowIds', workflowIds.join(','))
        }

        // Add folder filters if any
        if (folderIds.length > 0) {
          params.set('folderIds', folderIds.join(','))
        }

        // Add trigger filters if any
        if (triggers.length > 0) {
          params.set('triggers', triggers.join(','))
        }

        const response = await fetch(
          `/api/workspaces/${workspaceId}/execution-history?${params.toString()}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch execution history')
        }

        const data = await response.json()
        // Sort workflows by error rate (highest first)
        const sortedWorkflows = [...data.workflows].sort((a, b) => {
          const errorRateA = 100 - a.overallSuccessRate
          const errorRateB = 100 - b.overallSuccessRate
          return errorRateB - errorRateA
        })
        setExecutions(sortedWorkflows)

        // Compute aggregate segments across all workflows
        const segmentsCount: number = Number(params.get('segments') || DEFAULT_SEGMENTS)
        const agg: { timestamp: string; totalExecutions: number; successfulExecutions: number }[] =
          Array.from({ length: segmentsCount }, (_, i) => {
            const base = startTime.getTime()
            const span = endTime.getTime() - base
            const tsNum = base + Math.floor((i * span) / segmentsCount)
            const ts = new Date(tsNum)
            return {
              timestamp: Number.isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
              totalExecutions: 0,
              successfulExecutions: 0,
            }
          })
        for (const wf of data.workflows as any[]) {
          wf.segments.forEach((s: any, i: number) => {
            const index = Math.min(i, segmentsCount - 1)
            agg[index].totalExecutions += s.totalExecutions || 0
            agg[index].successfulExecutions += s.successfulExecutions || 0
          })
        }
        setAggregateSegments(agg)

        // Build charts from aggregate
        const errorRates = agg.map((s) => ({
          timestamp: s.timestamp,
          value: s.totalExecutions > 0 ? (1 - s.successfulExecutions / s.totalExecutions) * 100 : 0,
        }))
        const executionCounts = agg.map((s) => ({
          timestamp: s.timestamp,
          value: s.totalExecutions,
        }))

        // Fetch recent logs for the time window with current filters
        const logsParams = new URLSearchParams({
          limit: '50',
          offset: '0',
          workspaceId,
          startDate: startTime.toISOString(),
          endDate: endTime.toISOString(),
          order: 'desc',
          details: 'full',
        })
        if (workflowIds.length > 0) logsParams.set('workflowIds', workflowIds.join(','))
        if (folderIds.length > 0) logsParams.set('folderIds', folderIds.join(','))
        if (triggers.length > 0) logsParams.set('triggers', triggers.join(','))

        const logsResponse = await fetch(`/api/logs?${logsParams.toString()}`)
        let mappedLogs: ExecutionLog[] = []
        if (logsResponse.ok) {
          const logsData = await logsResponse.json()
          mappedLogs = (logsData.data || []).map((l: any) => {
            const started = l.startedAt
              ? new Date(l.startedAt)
              : l.endedAt
                ? new Date(l.endedAt)
                : null
            const startedAt =
              started && !Number.isNaN(started.getTime())
                ? started.toISOString()
                : new Date().toISOString()
            const durationCandidate =
              typeof l.totalDurationMs === 'number'
                ? l.totalDurationMs
                : typeof l.duration === 'number'
                  ? l.duration
                  : typeof l.totalDurationMs === 'string'
                    ? Number.parseInt(l.totalDurationMs.replace(/[^0-9]/g, ''), 10)
                    : typeof l.duration === 'string'
                      ? Number.parseInt(l.duration.replace(/[^0-9]/g, ''), 10)
                      : null
            // Extract a compact output for the table from executionData trace spans when available
            let output: any = null
            if (typeof l.output === 'string') {
              output = l.output
            } else if (l.executionData?.traceSpans && Array.isArray(l.executionData.traceSpans)) {
              const spans: any[] = l.executionData.traceSpans
              // Pick the last span that has an output or error-like payload
              for (let i = spans.length - 1; i >= 0; i--) {
                const s = spans[i]
                if (s?.output && Object.keys(s.output).length > 0) {
                  output = s.output
                  break
                }
                if (s?.status === 'error' && (s?.output?.error || s?.error)) {
                  output = s.output?.error || s.error
                  break
                }
              }
              if (!output && l.executionData?.output) {
                output = l.executionData.output
              }
            }
            if (!output) {
              // Some executions store output under executionData.blockExecutions
              const be = l.executionData?.blockExecutions
              if (Array.isArray(be) && be.length > 0) {
                const last = be[be.length - 1]
                output = last?.outputData || last?.errorMessage || null
              }
            }
            if (!output) output = l.message || null

            return {
              id: l.id,
              executionId: l.executionId,
              startedAt,
              level: l.level || 'info',
              trigger: l.trigger || 'manual',
              triggerUserId: l.triggerUserId || null,
              triggerInputs: undefined,
              outputs: output || undefined,
              errorMessage: l.error || null,
              duration: Number.isFinite(durationCandidate as number)
                ? (durationCandidate as number)
                : null,
              cost: l.cost
                ? { input: l.cost.input || 0, output: l.cost.output || 0, total: l.cost.total || 0 }
                : null,
              workflowName: l.workflowName || l.workflow?.name,
              workflowColor: l.workflowColor || l.workflow?.color,
            } as ExecutionLog
          })
        }

        setGlobalDetails({
          errorRates,
          durations: [],
          executionCounts,
          logs: mappedLogs,
          allLogs: mappedLogs,
        })
      } catch (err) {
        console.error('Error fetching executions:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
        setIsRefetching(false)
      }
    },
    [workspaceId, timeFilter, endTime, getStartTime, workflowIds, folderIds, triggers, segmentCount]
  )

  const fetchWorkflowDetails = useCallback(
    async (workflowId: string, silent = false) => {
      try {
        const startTime = getStartTime()
        const params = new URLSearchParams({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        })

        // Add trigger filters if any
        if (triggers.length > 0) {
          params.set('triggers', triggers.join(','))
        }

        const response = await fetch(
          `/api/workspaces/${workspaceId}/execution-history/${workflowId}?${params.toString()}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch workflow details')
        }

        const data = await response.json()
        // Store both filtered and all logs - update smoothly without clearing
        setWorkflowDetails((prev) => ({
          ...prev,
          [workflowId]: {
            ...data,
            allLogs: data.logs, // Keep a copy of all logs for filtering
          },
        }))
      } catch (err) {
        console.error('Error fetching workflow details:', err)
      }
    },
    [workspaceId, endTime, getStartTime, triggers]
  )

  const toggleWorkflow = useCallback(
    (workflowId: string) => {
      if (expandedWorkflowId === workflowId) {
        setExpandedWorkflowId(null)
        setSelectedSegmentIndices([])
        setLastAnchorIndex(null)
      } else {
        setExpandedWorkflowId(workflowId)
        setSelectedSegmentIndices([])
        setLastAnchorIndex(null)
        if (!workflowDetails[workflowId]) {
          fetchWorkflowDetails(workflowId)
        }
      }
    },
    [expandedWorkflowId, workflowDetails, fetchWorkflowDetails]
  )

  const handleSegmentClick = useCallback(
    (
      workflowId: string,
      segmentIndex: number,
      _timestamp: string,
      mode: 'single' | 'toggle' | 'range'
    ) => {
      // Open the workflow details if not already open
      if (expandedWorkflowId !== workflowId) {
        setExpandedWorkflowId(workflowId)
        if (!workflowDetails[workflowId]) {
          fetchWorkflowDetails(workflowId)
        }
        // Select the segment when opening a new workflow
        setSelectedSegmentIndices([segmentIndex])
        setLastAnchorIndex(segmentIndex)
      } else {
        setSelectedSegmentIndices((prev) => {
          if (mode === 'single') {
            setLastAnchorIndex(segmentIndex)
            // If already selected, deselect it; otherwise select only this one
            if (prev.includes(segmentIndex)) {
              return prev.filter((i) => i !== segmentIndex)
            }
            return [segmentIndex]
          }
          if (mode === 'toggle') {
            const exists = prev.includes(segmentIndex)
            const next = exists ? prev.filter((i) => i !== segmentIndex) : [...prev, segmentIndex]
            setLastAnchorIndex(segmentIndex)
            return next.sort((a, b) => a - b)
          }
          // range mode
          const anchor = lastAnchorIndex ?? segmentIndex
          const [start, end] =
            anchor < segmentIndex ? [anchor, segmentIndex] : [segmentIndex, anchor]
          const range = Array.from({ length: end - start + 1 }, (_, i) => start + i)
          const union = new Set([...(prev || []), ...range])
          return Array.from(union).sort((a, b) => a - b)
        })
      }
    },
    [expandedWorkflowId, workflowDetails, fetchWorkflowDetails, lastAnchorIndex]
  )

  // Initial load and refetch on dependencies change
  const isInitialMount = useRef(true)
  useEffect(() => {
    const isInitial = isInitialMount.current
    if (isInitial) {
      isInitialMount.current = false
    }
    fetchExecutions(isInitial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, timeFilter, endTime, workflowIds, folderIds, triggers, segmentCount])

  // Refetch workflow details when time, filters, or expanded workflow changes
  useEffect(() => {
    if (expandedWorkflowId) {
      fetchWorkflowDetails(expandedWorkflowId)
    }
  }, [expandedWorkflowId, timeFilter, endTime, workflowIds, folderIds, fetchWorkflowDetails])

  // Clear segment selection when time or filters change
  useEffect(() => {
    setSelectedSegmentIndices([])
    setLastAnchorIndex(null)
  }, [timeFilter, endTime, workflowIds, folderIds, triggers])

  // Observe bars area width to determine segment count responsively
  useEffect(() => {
    if (!barsAreaRef.current) return
    const el = barsAreaRef.current
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect?.width || 720
      // reserve approx 2px gap between cells
      const n = Math.max(36, Math.min(96, Math.floor(w / MIN_SEGMENT_PX)))
      setSegmentCount(n)
    })
    ro.observe(el)
    // initialize immediately
    const rect = el.getBoundingClientRect()
    if (rect?.width) {
      const n = Math.max(36, Math.min(96, Math.floor(rect.width / MIN_SEGMENT_PX)))
      setSegmentCount(n)
    }
    return () => ro.disconnect()
  }, [])

  const getShiftLabel = () => {
    switch (sidebarTimeRange) {
      case 'Past 30 minutes':
        return '30 minutes'
      case 'Past hour':
        return 'hour'
      case 'Past 12 hours':
        return '12 hours'
      case 'Past 24 hours':
        return '24 hours'
      default:
        return 'period'
    }
  }

  const getDateRange = () => {
    const start = getStartTime()
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', year: 'numeric' })}`
  }

  const shiftTimeWindow = (direction: 'back' | 'forward') => {
    let shift: number
    switch (timeFilter) {
      case '30m':
        shift = 30 * 60 * 1000
        break
      case '1h':
        shift = 60 * 60 * 1000
        break
      case '6h':
        shift = 6 * 60 * 60 * 1000
        break
      case '12h':
        shift = 12 * 60 * 60 * 1000
        break
      case '24h':
        shift = 24 * 60 * 60 * 1000
        break
      case '3d':
        shift = 3 * 24 * 60 * 60 * 1000
        break
      case '7d':
        shift = 7 * 24 * 60 * 60 * 1000
        break
      case '14d':
        shift = 14 * 24 * 60 * 60 * 1000
        break
      case '30d':
        shift = 30 * 24 * 60 * 60 * 1000
        break
      default:
        shift = 24 * 60 * 60 * 1000
    }

    setEndTime((prev) => new Date(prev.getTime() + (direction === 'forward' ? shift : -shift)))
  }

  const resetToNow = () => {
    setEndTime(new Date())
  }

  const isLive = endTime.getTime() > Date.now() - 60000 // Within last minute
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
                    {/* Removed the "Historical" badge per design feedback */}
                    {(workflowIds.length > 0 || folderIds.length > 0 || triggers.length > 0) && (
                      <div className='flex items-center gap-2 text-muted-foreground text-xs'>
                        <span>Filters:</span>
                        {workflowIds.length > 0 && (
                          <span className='inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                            {workflowIds.length} workflow{workflowIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {folderIds.length > 0 && (
                          <span className='inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                            {folderIds.length} folder{folderIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {triggers.length > 0 && (
                          <span className='inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-primary text-xs'>
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
                    selectedSegmentIndex={selectedSegmentIndices as any}
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

                    // Prepare filtered logs for details
                    const details = workflowDetails[expandedWorkflowId]
                    let logsToDisplay = (details?.logs || []).map((log) => ({
                      ...log,
                      // Always ensure a visible workflow name when a single workflow is expanded
                      workflowName: (log as any).workflowName || wf.workflowName,
                    }))
                    if (details && selectedSegmentIndices.length > 0) {
                      const totalMs = endTime.getTime() - getStartTime().getTime()
                      const segMs = totalMs / Math.max(1, segmentCount)

                      const windows = selectedSegmentIndices
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
                          // Ensure workflow name is visible in the table for multi-select
                          ...log,
                          workflowName: (log as any).workflowName || wf.workflowName,
                        }))

                      const minStart = new Date(Math.min(...windows.map((w) => w.start)))
                      const maxEnd = new Date(Math.max(...windows.map((w) => w.end)))

                      let filteredErrorRates = (details.errorRates || []).filter((p: any) =>
                        inAnyWindow(new Date(p.timestamp).getTime())
                      )
                      let filteredDurations = (
                        Array.isArray((details as any).durations) ? (details as any).durations : []
                      ).filter((p: any) => inAnyWindow(new Date(p.timestamp).getTime()))
                      let filteredExecutionCounts = (details.executionCounts || []).filter(
                        (p: any) => inAnyWindow(new Date(p.timestamp).getTime())
                      )

                      if (filteredErrorRates.length === 0 || filteredExecutionCounts.length === 0) {
                        const series = buildSeriesFromLogs(logsToDisplay, minStart, maxEnd, 8)
                        filteredErrorRates = series.errorRates
                        filteredExecutionCounts = series.executionCounts
                        filteredDurations = series.durations
                      }

                      ;(details as any).__filtered = {
                        errorRates: filteredErrorRates,
                        durations: filteredDurations,
                        executionCounts: filteredExecutionCounts,
                      }
                    }

                    const detailsWithFilteredLogs = details
                      ? {
                          ...details,
                          logs: logsToDisplay,
                          errorRates:
                            (details as any).__filtered?.errorRates ||
                            details.errorRates ||
                            buildSeriesFromLogs(
                              logsToDisplay,
                              new Date(
                                wf.segments[0]?.timestamp ||
                                  logsToDisplay[0]?.startedAt ||
                                  new Date().toISOString()
                              ),
                              endTime,
                              8
                            ).errorRates,
                          durations:
                            (details as any).__filtered?.durations ||
                            (details as any).durations ||
                            buildSeriesFromLogs(
                              logsToDisplay,
                              new Date(
                                wf.segments[0]?.timestamp ||
                                  logsToDisplay[0]?.startedAt ||
                                  new Date().toISOString()
                              ),
                              endTime,
                              8
                            ).durations,
                          executionCounts:
                            (details as any).__filtered?.executionCounts ||
                            details.executionCounts ||
                            buildSeriesFromLogs(
                              logsToDisplay,
                              new Date(
                                wf.segments[0]?.timestamp ||
                                  logsToDisplay[0]?.startedAt ||
                                  new Date().toISOString()
                              ),
                              endTime,
                              8
                            ).executionCounts,
                        }
                      : undefined

                    const selectedSegment =
                      selectedSegmentIndices.length === 1
                        ? wf.segments[selectedSegmentIndices[0]]
                        : null

                    return (
                      <WorkflowDetails
                        workspaceId={workspaceId}
                        expandedWorkflowId={expandedWorkflowId}
                        workflowName={wf.workflowName}
                        overview={{ total, success, failures, rate }}
                        details={detailsWithFilteredLogs as any}
                        selectedSegmentIndex={selectedSegmentIndices}
                        selectedSegment={
                          selectedSegment
                            ? {
                                timestamp: selectedSegment.timestamp,
                                totalExecutions: selectedSegment.totalExecutions,
                              }
                            : null
                        }
                        clearSegmentSelection={() => {
                          setSelectedSegmentIndices([])
                          setLastAnchorIndex(null)
                        }}
                        formatCost={formatCost}
                      />
                    )
                  }

                  // Aggregate view for all workflows
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
                      clearSegmentSelection={() => {
                        setSelectedSegmentIndices([])
                        setLastAnchorIndex(null)
                      }}
                      formatCost={formatCost}
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
