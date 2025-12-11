'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatLatency,
  mapToExecutionLog,
  mapToExecutionLogAlt,
} from '@/app/workspace/[workspaceId]/logs/utils'
import {
  useExecutionsMetrics,
  useGlobalDashboardLogs,
  useWorkflowDashboardLogs,
} from '@/hooks/queries/logs'
import { useFilterStore } from '@/stores/logs/filters/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { LineChart, WorkflowsList } from './components'

type TimeFilter = '30m' | '1h' | '6h' | '12h' | '24h' | '3d' | '7d' | '14d' | '30d'

interface WorkflowExecution {
  workflowId: string
  workflowName: string
  segments: {
    successRate: number
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

/**
 * Skeleton loader for a single graph card
 */
function GraphCardSkeleton({ title }: { title: string }) {
  return (
    <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-elevated)]'>
      <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px]'>
        <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
          {title}
        </span>
        <Skeleton className='h-[20px] w-[40px]' />
      </div>
      <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-1)] px-[14px] py-[10px]'>
        <div className='flex h-[166px] flex-col justify-end gap-[4px]'>
          {/* Skeleton bars simulating chart */}
          <div className='flex items-end gap-[2px]'>
            {Array.from({ length: 24 }).map((_, i) => (
              <Skeleton
                key={i}
                className='flex-1'
                style={{
                  height: `${Math.random() * 80 + 20}%`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Skeleton loader for a workflow row in the workflows list
 */
function WorkflowRowSkeleton() {
  return (
    <div className='flex h-[44px] items-center gap-[16px] px-[24px]'>
      {/* Workflow name with color */}
      <div className='flex w-[160px] flex-shrink-0 items-center gap-[8px] pr-[8px]'>
        <Skeleton className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]' />
        <Skeleton className='h-[16px] flex-1' />
      </div>

      {/* Status bar - takes most of the space */}
      <div className='flex-1'>
        <Skeleton className='h-[24px] w-full rounded-[4px]' />
      </div>

      {/* Success rate */}
      <div className='w-[100px] flex-shrink-0 pl-[16px]'>
        <Skeleton className='h-[16px] w-[50px]' />
      </div>
    </div>
  )
}

/**
 * Skeleton loader for the workflows list table
 */
function WorkflowsListSkeleton({ rowCount = 5 }: { rowCount?: number }) {
  return (
    <div className='flex h-full flex-col overflow-hidden rounded-[6px] bg-[var(--surface-1)]'>
      {/* Table header */}
      <div className='flex-shrink-0 rounded-t-[6px] bg-[var(--surface-3)] px-[24px] py-[10px]'>
        <div className='flex items-center gap-[16px]'>
          <span className='w-[160px] flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
            Workflow
          </span>
          <span className='flex-1 font-medium text-[12px] text-[var(--text-tertiary)]'>Logs</span>
          <span className='w-[100px] flex-shrink-0 pl-[16px] font-medium text-[12px] text-[var(--text-tertiary)]'>
            Success Rate
          </span>
        </div>
      </div>

      {/* Table body - scrollable */}
      <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
        {Array.from({ length: rowCount }).map((_, i) => (
          <WorkflowRowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

/**
 * Complete skeleton loader for the entire dashboard
 */
function DashboardSkeleton() {
  return (
    <div className='mt-[24px] flex min-h-0 flex-1 flex-col pb-[24px]'>
      {/* Graphs Section */}
      <div className='mb-[16px] flex-shrink-0'>
        <div className='grid grid-cols-1 gap-[16px] md:grid-cols-3'>
          <GraphCardSkeleton title='Runs' />
          <GraphCardSkeleton title='Errors' />
          <GraphCardSkeleton title='Latency' />
        </div>
      </div>

      {/* Workflows Table - takes remaining space */}
      <div className='min-h-0 flex-1 overflow-hidden'>
        <WorkflowsListSkeleton rowCount={14} />
      </div>
    </div>
  )
}

interface DashboardProps {
  isLive?: boolean
  refreshTrigger?: number
  onCustomTimeRangeChange?: (isCustom: boolean) => void
}

export default function Dashboard({
  isLive = false,
  refreshTrigger = 0,
  onCustomTimeRangeChange,
}: DashboardProps) {
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
        return '30d'
    }
  }

  const [endTime, setEndTime] = useState<Date>(new Date())
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [selectedSegments, setSelectedSegments] = useState<Record<string, number[]>>({})
  const [lastAnchorIndices, setLastAnchorIndices] = useState<Record<string, number>>({})
  const [segmentCount, setSegmentCount] = useState<number>(DEFAULT_SEGMENTS)
  const barsAreaRef = useRef<HTMLDivElement | null>(null)

  const {
    workflowIds,
    folderIds,
    triggers,
    timeRange: sidebarTimeRange,
    level,
    searchQuery,
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
      level: level !== 'all' ? level : undefined,
    }),
    [workspaceId, segmentCount, getStartTime, endTime, workflowIds, folderIds, triggers, level]
  )

  const logsFilters = useMemo(
    () => ({
      workspaceId,
      startDate: getStartTime().toISOString(),
      endDate: endTime.toISOString(),
      workflowIds: workflowIds.length > 0 ? workflowIds : undefined,
      folderIds: folderIds.length > 0 ? folderIds : undefined,
      triggers: triggers.length > 0 ? triggers : undefined,
      level: level !== 'all' ? level : undefined,
      searchQuery: searchQuery.trim() || undefined,
      limit: 50,
    }),
    [workspaceId, getStartTime, endTime, workflowIds, folderIds, triggers, level, searchQuery]
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
  const error = metricsQuery.error?.message ?? null

  // Check if any filters are actually applied
  const hasActiveFilters = useMemo(
    () =>
      level !== 'all' ||
      workflowIds.length > 0 ||
      folderIds.length > 0 ||
      triggers.length > 0 ||
      searchQuery.trim() !== '',
    [level, workflowIds, folderIds, triggers, searchQuery]
  )

  // Filter workflows based on search query and whether they have any executions matching the filters
  const filteredExecutions = useMemo(() => {
    let filtered = executions

    // Only filter out workflows with no executions if filters are active
    if (hasActiveFilters) {
      filtered = filtered.filter((workflow) => {
        const hasExecutions = workflow.segments.some((seg) => seg.hasExecutions === true)
        return hasExecutions
      })
    }

    // Apply search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter((workflow) => workflow.workflowName.toLowerCase().includes(query))
    }

    // Sort by creation date (newest first) to match sidebar ordering
    filtered = filtered.sort((a, b) => {
      const workflowA = workflows[a.workflowId]
      const workflowB = workflows[b.workflowId]
      if (!workflowA || !workflowB) return 0
      return workflowB.createdAt.getTime() - workflowA.createdAt.getTime()
    })

    return filtered
  }, [executions, searchQuery, hasActiveFilters, workflows])

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

    const hasSelection = Object.keys(selectedSegments).length > 0
    const hasWorkflowFilter = expandedWorkflowId && expandedWorkflowId !== '__multi__'

    // Stack filters: workflow filter + segment selection
    const segmentsToUse = hasSelection
      ? (() => {
          // Get all selected segment indices across all workflows
          const allSelectedIndices = new Set<number>()
          Object.values(selectedSegments).forEach((indices) => {
            indices.forEach((idx) => allSelectedIndices.add(idx))
          })

          // For each selected index, aggregate data from workflows that have that segment selected
          // If a workflow filter is active, only include that workflow's data
          return Array.from(allSelectedIndices)
            .sort((a, b) => a - b)
            .map((idx) => {
              let totalExecutions = 0
              let successfulExecutions = 0
              let weightedLatencySum = 0
              let latencyCount = 0
              const timestamp = aggregateSegments[idx]?.timestamp || ''

              // Sum up data from workflows that have this segment selected
              Object.entries(selectedSegments).forEach(([workflowId, indices]) => {
                if (!indices.includes(idx)) return

                // If workflow filter is active, skip other workflows
                if (hasWorkflowFilter && workflowId !== expandedWorkflowId) return

                const workflow = filteredExecutions.find((w) => w.workflowId === workflowId)
                const segment = workflow?.segments[idx]
                if (!segment) return

                totalExecutions += segment.totalExecutions || 0
                successfulExecutions += segment.successfulExecutions || 0

                if (segment.avgDurationMs && segment.totalExecutions) {
                  weightedLatencySum += segment.avgDurationMs * segment.totalExecutions
                  latencyCount += segment.totalExecutions
                }
              })

              return {
                timestamp,
                totalExecutions,
                successfulExecutions,
                avgDurationMs: latencyCount > 0 ? weightedLatencySum / latencyCount : 0,
              }
            })
        })()
      : hasWorkflowFilter
        ? (() => {
            // Filter to show only the expanded workflow's data
            const workflow = filteredExecutions.find((w) => w.workflowId === expandedWorkflowId)
            if (!workflow) return aggregateSegments

            return workflow.segments.map((segment) => ({
              timestamp: segment.timestamp,
              totalExecutions: segment.totalExecutions || 0,
              successfulExecutions: segment.successfulExecutions || 0,
              avgDurationMs: segment.avgDurationMs ?? 0,
            }))
          })()
        : hasActiveFilters
          ? (() => {
              // Always recalculate aggregate segments based on filtered workflows when filters are active
              return aggregateSegments.map((aggSeg, idx) => {
                let totalExecutions = 0
                let successfulExecutions = 0
                let weightedLatencySum = 0
                let latencyCount = 0

                filteredExecutions.forEach((workflow) => {
                  const segment = workflow.segments[idx]
                  if (!segment) return

                  totalExecutions += segment.totalExecutions || 0
                  successfulExecutions += segment.successfulExecutions || 0

                  if (segment.avgDurationMs && segment.totalExecutions) {
                    weightedLatencySum += segment.avgDurationMs * segment.totalExecutions
                    latencyCount += segment.totalExecutions
                  }
                })

                return {
                  timestamp: aggSeg.timestamp,
                  totalExecutions,
                  successfulExecutions,
                  avgDurationMs: latencyCount > 0 ? weightedLatencySum / latencyCount : 0,
                }
              })
            })()
          : aggregateSegments

    const errorRates = segmentsToUse.map((s) => ({
      timestamp: s.timestamp,
      value: s.totalExecutions > 0 ? (1 - s.successfulExecutions / s.totalExecutions) * 100 : 0,
    }))

    const executionCounts = segmentsToUse.map((s) => ({
      timestamp: s.timestamp,
      value: s.totalExecutions,
    }))

    const failureCounts = segmentsToUse.map((s) => ({
      timestamp: s.timestamp,
      value: s.totalExecutions - s.successfulExecutions,
    }))

    const latencies = segmentsToUse.map((s) => ({
      timestamp: s.timestamp,
      value: s.avgDurationMs ?? 0,
    }))

    return {
      errorRates,
      durations: [],
      executionCounts,
      failureCounts,
      latencies,
      logs: globalLogs,
      allLogs: globalLogs,
    }
  }, [
    aggregateSegments,
    globalLogs,
    selectedSegments,
    filteredExecutions,
    expandedWorkflowId,
    hasActiveFilters,
  ])

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

  const aggregate = useMemo(() => {
    const hasSelection = Object.keys(selectedSegments).length > 0
    const hasWorkflowFilter = expandedWorkflowId && expandedWorkflowId !== '__multi__'
    let totalExecutions = 0
    let successfulExecutions = 0
    let activeWorkflows = 0
    let weightedLatencySum = 0
    let latencyExecutionCount = 0

    // Apply workflow filter first if present, otherwise use filtered executions
    const workflowsToProcess = hasWorkflowFilter
      ? filteredExecutions.filter((wf) => wf.workflowId === expandedWorkflowId)
      : filteredExecutions

    for (const wf of workflowsToProcess) {
      const selectedIndices = hasSelection ? selectedSegments[wf.workflowId] : null
      let workflowHasExecutions = false

      wf.segments.forEach((seg, idx) => {
        // If segment selection exists, only count selected segments
        // Otherwise, count all segments
        if (!selectedIndices || selectedIndices.includes(idx)) {
          const execCount = seg.totalExecutions || 0
          totalExecutions += execCount
          successfulExecutions += seg.successfulExecutions || 0

          if (
            seg.avgDurationMs !== undefined &&
            seg.avgDurationMs !== null &&
            seg.avgDurationMs > 0 &&
            execCount > 0
          ) {
            weightedLatencySum += seg.avgDurationMs * execCount
            latencyExecutionCount += execCount
          }
          if (seg.hasExecutions) workflowHasExecutions = true
        }
      })

      if (workflowHasExecutions) activeWorkflows += 1
    }

    const failedExecutions = Math.max(totalExecutions - successfulExecutions, 0)
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 100
    const avgLatency = latencyExecutionCount > 0 ? weightedLatencySum / latencyExecutionCount : 0

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      activeWorkflows,
      successRate,
      avgLatency,
    }
  }, [filteredExecutions, selectedSegments, expandedWorkflowId])

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
        setSelectedSegments({})
        setLastAnchorIndices({})
      } else {
        setExpandedWorkflowId(workflowId)
        setSelectedSegments({})
        setLastAnchorIndices({})
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
    [expandedWorkflowId, lastAnchorIndices]
  )

  // Update endTime when filters change to ensure consistent time ranges with logs view
  useEffect(() => {
    setEndTime(new Date())
    setSelectedSegments({})
    setLastAnchorIndices({})
  }, [timeFilter, workflowIds, folderIds, triggers, level, searchQuery])

  // Clear expanded workflow if it's no longer in filtered executions
  useEffect(() => {
    if (expandedWorkflowId && expandedWorkflowId !== '__multi__') {
      const isStillVisible = filteredExecutions.some((wf) => wf.workflowId === expandedWorkflowId)
      if (!isStillVisible) {
        setExpandedWorkflowId(null)
        setSelectedSegments({})
        setLastAnchorIndices({})
      }
    } else if (expandedWorkflowId === '__multi__') {
      // Check if any of the selected workflows are still visible
      const selectedWorkflowIds = Object.keys(selectedSegments)
      const stillVisibleIds = selectedWorkflowIds.filter((id) =>
        filteredExecutions.some((wf) => wf.workflowId === id)
      )

      if (stillVisibleIds.length === 0) {
        setExpandedWorkflowId(null)
        setSelectedSegments({})
        setLastAnchorIndices({})
      } else if (stillVisibleIds.length !== selectedWorkflowIds.length) {
        // Remove segments for workflows that are no longer visible
        const updatedSegments: Record<string, number[]> = {}
        stillVisibleIds.forEach((id) => {
          if (selectedSegments[id]) {
            updatedSegments[id] = selectedSegments[id]
          }
        })
        setSelectedSegments(updatedSegments)

        if (stillVisibleIds.length === 1) {
          setExpandedWorkflowId(stillVisibleIds[0])
        }
      }
    }
  }, [filteredExecutions, expandedWorkflowId, selectedSegments])

  // Notify parent when custom time range is active
  useEffect(() => {
    const hasCustomRange = Object.keys(selectedSegments).length > 0
    onCustomTimeRangeChange?.(hasCustomRange)
  }, [selectedSegments, onCustomTimeRangeChange])

  useEffect(() => {
    if (!barsAreaRef.current) return
    const el = barsAreaRef.current
    let debounceId: ReturnType<typeof setTimeout> | null = null
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

  // Live mode: refresh endTime periodically
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => {
      setEndTime(new Date())
    }, 5000)
    return () => clearInterval(interval)
  }, [isLive])

  // Refresh when trigger changes
  useEffect(() => {
    if (refreshTrigger > 0) {
      setEndTime(new Date())
    }
  }, [refreshTrigger])

  if (loading) {
    return <DashboardSkeleton />
  }

  if (error) {
    return (
      <div className='mt-[24px] flex flex-1 items-center justify-center'>
        <div className='text-[var(--text-error)]'>
          <p className='font-medium text-[13px]'>Error loading data</p>
          <p className='text-[12px]'>{error}</p>
        </div>
      </div>
    )
  }

  if (executions.length === 0) {
    return (
      <div className='mt-[24px] flex flex-1 items-center justify-center'>
        <div className='text-center text-[var(--text-secondary)]'>
          <p className='font-medium text-[13px]'>No execution history</p>
          <p className='mt-[4px] text-[12px]'>Execute some workflows to see their history here</p>
        </div>
      </div>
    )
  }

  return (
    <div className='mt-[24px] flex min-h-0 flex-1 flex-col pb-[24px]'>
      {/* Graphs Section */}
      <div className='mb-[16px] flex-shrink-0'>
        <div className='grid grid-cols-1 gap-[16px] md:grid-cols-3'>
          {/* Runs Graph */}
          <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-elevated)]'>
            <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px]'>
              <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
                Runs
              </span>
              {globalDetails && globalDetails.executionCounts.length > 0 && (
                <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
                  {aggregate.totalExecutions}
                </span>
              )}
            </div>
            <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-1)] px-[14px] py-[10px]'>
              {globalDetails ? (
                <LineChart
                  key={`runs-${expandedWorkflowId || 'all'}-${Object.keys(selectedSegments).length}-${filteredExecutions.length}`}
                  data={globalDetails.executionCounts}
                  label=''
                  color='var(--brand-tertiary)'
                  unit=''
                />
              ) : (
                <div className='flex h-[166px] items-center justify-center'>
                  <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-secondary)]' />
                </div>
              )}
            </div>
          </div>

          {/* Errors Graph */}
          <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-elevated)]'>
            <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px]'>
              <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
                Errors
              </span>
              {globalDetails && globalDetails.failureCounts.length > 0 && (
                <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
                  {aggregate.failedExecutions}
                </span>
              )}
            </div>
            <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-1)] px-[14px] py-[10px]'>
              {globalDetails ? (
                <LineChart
                  key={`errors-${expandedWorkflowId || 'all'}-${Object.keys(selectedSegments).length}-${filteredExecutions.length}`}
                  data={globalDetails.failureCounts}
                  label=''
                  color='var(--text-error)'
                  unit=''
                />
              ) : (
                <div className='flex h-[166px] items-center justify-center'>
                  <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-secondary)]' />
                </div>
              )}
            </div>
          </div>

          {/* Latency Graph */}
          <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-elevated)]'>
            <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px]'>
              <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
                Latency
              </span>
              {globalDetails && globalDetails.latencies.length > 0 && (
                <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
                  {formatLatency(aggregate.avgLatency)}
                </span>
              )}
            </div>
            <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-1)] px-[14px] py-[10px]'>
              {globalDetails ? (
                <LineChart
                  key={`latency-${expandedWorkflowId || 'all'}-${Object.keys(selectedSegments).length}-${filteredExecutions.length}`}
                  data={globalDetails.latencies}
                  label=''
                  color='var(--c-F59E0B)'
                  unit='latency'
                />
              ) : (
                <div className='flex h-[166px] items-center justify-center'>
                  <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-secondary)]' />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Workflows Table - takes remaining space */}
      <div className='min-h-0 flex-1 overflow-hidden' ref={barsAreaRef}>
        <WorkflowsList
          executions={executions as WorkflowExecution[]}
          filteredExecutions={filteredExecutions as WorkflowExecution[]}
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
  )
}
