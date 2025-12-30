'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLatency, parseDuration } from '@/app/workspace/[workspaceId]/logs/utils'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { LineChart, WorkflowsList } from './components'

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
const MIN_SEGMENT_MS = 60000

const SKELETON_BAR_HEIGHTS = [
  45, 72, 38, 85, 52, 68, 30, 90, 55, 42, 78, 35, 88, 48, 65, 28, 82, 58, 40, 75, 32, 95, 50, 70,
]

function GraphCardSkeleton({ title }: { title: string }) {
  return (
    <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-2)]'>
      <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px] dark:bg-[var(--surface-3)]'>
        <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
          {title}
        </span>
        <Skeleton className='h-[20px] w-[40px]' />
      </div>
      <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-2)] px-[14px] py-[10px] dark:bg-[var(--surface-1)]'>
        <div className='flex h-[166px] flex-col justify-end gap-[4px]'>
          <div className='flex items-end gap-[2px]'>
            {SKELETON_BAR_HEIGHTS.map((height, i) => (
              <Skeleton
                key={i}
                className='flex-1'
                style={{
                  height: `${height}%`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WorkflowRowSkeleton() {
  return (
    <div className='flex h-[44px] items-center gap-[16px] px-[24px]'>
      <div className='flex w-[160px] flex-shrink-0 items-center gap-[8px] pr-[8px]'>
        <Skeleton className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]' />
        <Skeleton className='h-[16px] flex-1' />
      </div>
      <div className='flex-1'>
        <Skeleton className='h-[24px] w-full rounded-[4px]' />
      </div>
      <div className='w-[100px] flex-shrink-0 pl-[16px]'>
        <Skeleton className='h-[16px] w-[50px]' />
      </div>
    </div>
  )
}

function WorkflowsListSkeleton({ rowCount = 5 }: { rowCount?: number }) {
  return (
    <div className='flex h-full flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-1)]'>
      <div className='flex-shrink-0 rounded-t-[6px] bg-[var(--surface-3)] px-[24px] py-[10px] dark:bg-[var(--surface-3)]'>
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
      <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
        {Array.from({ length: rowCount }).map((_, i) => (
          <WorkflowRowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className='mt-[24px] flex min-h-0 flex-1 flex-col pb-[24px]'>
      <div className='mb-[16px] flex-shrink-0'>
        <div className='grid grid-cols-1 gap-[16px] md:grid-cols-3'>
          <GraphCardSkeleton title='Runs' />
          <GraphCardSkeleton title='Errors' />
          <GraphCardSkeleton title='Latency' />
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        <WorkflowsListSkeleton rowCount={14} />
      </div>
    </div>
  )
}

interface DashboardProps {
  logs: WorkflowLog[]
  isLoading: boolean
  error?: Error | null
}

export default function Dashboard({ logs, isLoading, error }: DashboardProps) {
  const [segmentCount, setSegmentCount] = useState<number>(DEFAULT_SEGMENTS)
  const [selectedSegments, setSelectedSegments] = useState<Record<string, number[]>>({})
  const [lastAnchorIndices, setLastAnchorIndices] = useState<Record<string, number>>({})
  const barsAreaRef = useRef<HTMLDivElement | null>(null)

  const { workflowIds, searchQuery, toggleWorkflowId, timeRange } = useFilterStore()

  const allWorkflows = useWorkflowRegistry((state) => state.workflows)

  const expandedWorkflowId = workflowIds.length === 1 ? workflowIds[0] : null

  const lastExecutionByWorkflow = useMemo(() => {
    const map = new Map<string, number>()
    for (const log of logs) {
      const wfId = log.workflowId
      if (!wfId) continue
      const ts = new Date(log.createdAt).getTime()
      const existing = map.get(wfId)
      if (!existing || ts > existing) {
        map.set(wfId, ts)
      }
    }
    return map
  }, [logs])

  const timeBounds = useMemo(() => {
    if (logs.length === 0) {
      const now = new Date()
      return { start: now, end: now }
    }

    let minTime = Number.POSITIVE_INFINITY
    let maxTime = Number.NEGATIVE_INFINITY

    for (const log of logs) {
      const ts = new Date(log.createdAt).getTime()
      if (ts < minTime) minTime = ts
      if (ts > maxTime) maxTime = ts
    }

    const end = new Date(Math.max(maxTime, Date.now()))
    const start = new Date(minTime)

    return { start, end }
  }, [logs])

  const { executions, aggregateSegments, segmentMs } = useMemo(() => {
    const allWorkflowsList = Object.values(allWorkflows)

    if (allWorkflowsList.length === 0) {
      return { executions: [], aggregateSegments: [], segmentMs: 0 }
    }

    const { start, end } =
      logs.length > 0
        ? timeBounds
        : { start: new Date(Date.now() - 24 * 60 * 60 * 1000), end: new Date() }

    const totalMs = Math.max(1, end.getTime() - start.getTime())
    const calculatedSegmentMs = Math.max(
      MIN_SEGMENT_MS,
      Math.floor(totalMs / Math.max(1, segmentCount))
    )

    const logsByWorkflow = new Map<string, WorkflowLog[]>()
    for (const log of logs) {
      const wfId = log.workflowId
      if (!logsByWorkflow.has(wfId)) {
        logsByWorkflow.set(wfId, [])
      }
      logsByWorkflow.get(wfId)!.push(log)
    }

    const workflowExecutions: WorkflowExecution[] = []

    for (const workflow of allWorkflowsList) {
      const workflowLogs = logsByWorkflow.get(workflow.id) || []

      const segments: WorkflowExecution['segments'] = Array.from(
        { length: segmentCount },
        (_, i) => ({
          timestamp: new Date(start.getTime() + i * calculatedSegmentMs).toISOString(),
          hasExecutions: false,
          totalExecutions: 0,
          successfulExecutions: 0,
          successRate: 100,
          avgDurationMs: 0,
        })
      )

      const durations: number[][] = Array.from({ length: segmentCount }, () => [])

      for (const log of workflowLogs) {
        const logTime = new Date(log.createdAt).getTime()
        const idx = Math.min(
          segmentCount - 1,
          Math.max(0, Math.floor((logTime - start.getTime()) / calculatedSegmentMs))
        )

        segments[idx].totalExecutions += 1
        segments[idx].hasExecutions = true

        if (log.level !== 'error') {
          segments[idx].successfulExecutions += 1
        }

        const duration = parseDuration({ duration: log.duration ?? undefined })
        if (duration !== null && duration > 0) {
          durations[idx].push(duration)
        }
      }

      let totalExecs = 0
      let totalSuccess = 0

      for (let i = 0; i < segmentCount; i++) {
        const seg = segments[i]
        totalExecs += seg.totalExecutions
        totalSuccess += seg.successfulExecutions

        if (seg.totalExecutions > 0) {
          seg.successRate = (seg.successfulExecutions / seg.totalExecutions) * 100
        }

        if (durations[i].length > 0) {
          seg.avgDurationMs = Math.round(
            durations[i].reduce((sum, d) => sum + d, 0) / durations[i].length
          )
        }
      }

      const overallSuccessRate = totalExecs > 0 ? (totalSuccess / totalExecs) * 100 : 100

      workflowExecutions.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        segments,
        overallSuccessRate,
      })
    }

    workflowExecutions.sort((a, b) => {
      const errA = a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
      const errB = b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
      if (errA !== errB) return errB - errA
      return a.workflowName.localeCompare(b.workflowName)
    })

    const aggSegments: {
      timestamp: string
      totalExecutions: number
      successfulExecutions: number
      avgDurationMs: number
    }[] = Array.from({ length: segmentCount }, (_, i) => ({
      timestamp: new Date(start.getTime() + i * calculatedSegmentMs).toISOString(),
      totalExecutions: 0,
      successfulExecutions: 0,
      avgDurationMs: 0,
    }))

    const weightedDurationSums: number[] = Array(segmentCount).fill(0)
    const executionCounts: number[] = Array(segmentCount).fill(0)

    for (const wf of workflowExecutions) {
      wf.segments.forEach((s, i) => {
        aggSegments[i].totalExecutions += s.totalExecutions
        aggSegments[i].successfulExecutions += s.successfulExecutions

        if (s.avgDurationMs && s.avgDurationMs > 0 && s.totalExecutions > 0) {
          weightedDurationSums[i] += s.avgDurationMs * s.totalExecutions
          executionCounts[i] += s.totalExecutions
        }
      })
    }

    aggSegments.forEach((seg, i) => {
      if (executionCounts[i] > 0) {
        seg.avgDurationMs = weightedDurationSums[i] / executionCounts[i]
      }
    })

    return {
      executions: workflowExecutions,
      aggregateSegments: aggSegments,
      segmentMs: calculatedSegmentMs,
    }
  }, [logs, timeBounds, segmentCount, allWorkflows])

  const filteredExecutions = useMemo(() => {
    let filtered = executions

    if (workflowIds.length > 0) {
      filtered = filtered.filter((wf) => workflowIds.includes(wf.workflowId))
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter((wf) => wf.workflowName.toLowerCase().includes(query))
    }

    return filtered.slice().sort((a, b) => {
      const timeA = lastExecutionByWorkflow.get(a.workflowId) ?? 0
      const timeB = lastExecutionByWorkflow.get(b.workflowId) ?? 0

      if (!timeA && !timeB) return a.workflowName.localeCompare(b.workflowName)
      if (!timeA) return 1
      if (!timeB) return -1

      return timeB - timeA
    })
  }, [executions, lastExecutionByWorkflow, workflowIds, searchQuery])

  const globalDetails = useMemo(() => {
    if (!aggregateSegments.length) return null

    const hasSelection = Object.keys(selectedSegments).length > 0
    const hasWorkflowFilter = expandedWorkflowId !== null

    const segmentsToUse = hasSelection
      ? (() => {
          const allSelectedIndices = new Set<number>()
          Object.values(selectedSegments).forEach((indices) => {
            indices.forEach((idx) => allSelectedIndices.add(idx))
          })

          return Array.from(allSelectedIndices)
            .sort((a, b) => a - b)
            .map((idx) => {
              let totalExecutions = 0
              let successfulExecutions = 0
              let weightedLatencySum = 0
              let latencyCount = 0
              const timestamp = aggregateSegments[idx]?.timestamp || ''

              Object.entries(selectedSegments).forEach(([workflowId, indices]) => {
                if (!indices.includes(idx)) return
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
            const workflow = filteredExecutions.find((w) => w.workflowId === expandedWorkflowId)
            if (!workflow) return aggregateSegments

            return workflow.segments.map((segment) => ({
              timestamp: segment.timestamp,
              totalExecutions: segment.totalExecutions || 0,
              successfulExecutions: segment.successfulExecutions || 0,
              avgDurationMs: segment.avgDurationMs ?? 0,
            }))
          })()
        : aggregateSegments

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

    const totalRuns = segmentsToUse.reduce((sum, s) => sum + s.totalExecutions, 0)
    const totalErrors = segmentsToUse.reduce(
      (sum, s) => sum + (s.totalExecutions - s.successfulExecutions),
      0
    )

    let weightedLatencySum = 0
    let latencyCount = 0
    for (const s of segmentsToUse) {
      if (s.avgDurationMs && s.totalExecutions > 0) {
        weightedLatencySum += s.avgDurationMs * s.totalExecutions
        latencyCount += s.totalExecutions
      }
    }
    const avgLatency = latencyCount > 0 ? weightedLatencySum / latencyCount : 0

    return {
      executionCounts,
      failureCounts,
      latencies,
      totalRuns,
      totalErrors,
      avgLatency,
    }
  }, [aggregateSegments, selectedSegments, filteredExecutions, expandedWorkflowId])

  const handleToggleWorkflow = useCallback(
    (workflowId: string) => {
      toggleWorkflowId(workflowId)
    },
    [toggleWorkflowId]
  )

  /**
   * Handles segment click for selecting time segments.
   * @param workflowId - The workflow containing the segment
   * @param segmentIndex - Index of the clicked segment
   * @param _timestamp - Timestamp of the segment (unused)
   * @param mode - Selection mode: 'single', 'toggle' (cmd+click), or 'range' (shift+click)
   */
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
            return rest
          }

          return { ...prev, [workflowId]: nextSegments }
        })

        setLastAnchorIndices((prev) => ({ ...prev, [workflowId]: segmentIndex }))
      } else if (mode === 'single') {
        setSelectedSegments((prev) => {
          const currentSegments = prev[workflowId] || []
          const isOnlySelectedSegment =
            currentSegments.length === 1 && currentSegments[0] === segmentIndex
          const isOnlyWorkflowSelected = Object.keys(prev).length === 1 && prev[workflowId]

          if (isOnlySelectedSegment && isOnlyWorkflowSelected) {
            setLastAnchorIndices({})
            return {}
          }

          setLastAnchorIndices({ [workflowId]: segmentIndex })
          return { [workflowId]: [segmentIndex] }
        })
      } else if (mode === 'range') {
        setSelectedSegments((prev) => {
          const currentSegments = prev[workflowId] || []
          const anchor = lastAnchorIndices[workflowId] ?? segmentIndex
          const [start, end] =
            anchor < segmentIndex ? [anchor, segmentIndex] : [segmentIndex, anchor]
          const range = Array.from({ length: end - start + 1 }, (_, i) => start + i)
          const union = new Set([...currentSegments, ...range])
          return { ...prev, [workflowId]: Array.from(union).sort((a, b) => a - b) }
        })
      }
    },
    [lastAnchorIndices]
  )

  useEffect(() => {
    setSelectedSegments({})
    setLastAnchorIndices({})
  }, [logs, timeRange, workflowIds, searchQuery])

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

  if (isLoading) {
    return <DashboardSkeleton />
  }

  // Show error state
  if (error) {
    return (
      <div className='mt-[24px] flex flex-1 items-center justify-center'>
        <div className='text-[var(--text-error)]'>
          <p className='font-medium text-[13px]'>Error loading data</p>
          <p className='text-[12px]'>{error.message}</p>
        </div>
      </div>
    )
  }

  if (Object.keys(allWorkflows).length === 0) {
    return (
      <div className='mt-[24px] flex flex-1 items-center justify-center'>
        <div className='text-center text-[var(--text-secondary)]'>
          <p className='font-medium text-[13px]'>No workflows</p>
          <p className='mt-[4px] text-[12px]'>
            Create a workflow to see its execution history here
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className='mt-[24px] flex min-h-0 flex-1 flex-col pb-[24px]'>
      <div className='mb-[16px] flex-shrink-0'>
        <div className='grid grid-cols-1 gap-[16px] md:grid-cols-3'>
          <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-2)]'>
            <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px] dark:bg-[var(--surface-3)]'>
              <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
                Runs
              </span>
              {globalDetails && (
                <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
                  {globalDetails.totalRuns}
                </span>
              )}
            </div>
            <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-2)] px-[14px] py-[10px] dark:bg-[var(--surface-1)]'>
              {globalDetails ? (
                <LineChart
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

          <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-2)]'>
            <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px] dark:bg-[var(--surface-3)]'>
              <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
                Errors
              </span>
              {globalDetails && (
                <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
                  {globalDetails.totalErrors}
                </span>
              )}
            </div>
            <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-2)] px-[14px] py-[10px] dark:bg-[var(--surface-1)]'>
              {globalDetails ? (
                <LineChart
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

          <div className='flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-2)]'>
            <div className='flex min-w-0 items-center justify-between gap-[8px] bg-[var(--surface-3)] px-[16px] py-[9px] dark:bg-[var(--surface-3)]'>
              <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-sm'>
                Latency
              </span>
              {globalDetails && (
                <span className='flex-shrink-0 font-medium text-[var(--text-secondary)] text-sm'>
                  {formatLatency(globalDetails.avgLatency)}
                </span>
              )}
            </div>
            <div className='flex-1 overflow-y-auto rounded-t-[6px] bg-[var(--surface-2)] px-[14px] py-[10px] dark:bg-[var(--surface-1)]'>
              {globalDetails ? (
                <LineChart
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

      <div className='min-h-0 flex-1 overflow-hidden' ref={barsAreaRef}>
        <WorkflowsList
          filteredExecutions={filteredExecutions as WorkflowExecution[]}
          expandedWorkflowId={expandedWorkflowId}
          onToggleWorkflow={handleToggleWorkflow}
          selectedSegments={selectedSegments}
          onSegmentClick={handleSegmentClick}
          searchQuery={searchQuery}
          segmentDurationMs={segmentMs}
        />
      </div>
    </div>
  )
}
