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

interface WorkflowDetailsDataLocal {
  errorRates: { timestamp: string; value: number }[]
  durations: { timestamp: string; value: number }[]
  executionCounts: { timestamp: string; value: number }[]
  logs: ExecutionLog[]
  allLogs: ExecutionLog[]
  __meta?: { offset: number; hasMore: boolean }
}

export default function ExecutionsDashboard() {
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
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefetching, setIsRefetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowDetailsDataLocal>>(
    {}
  )
  const [globalDetails, setGlobalDetails] = useState<WorkflowDetailsDataLocal | null>(null)
  const [globalLogsMeta, setGlobalLogsMeta] = useState<{ offset: number; hasMore: boolean }>({
    offset: 0,
    hasMore: true,
  })
  const [globalLoadingMore, setGlobalLoadingMore] = useState(false)
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

        if (workflowIds.length > 0) {
          params.set('workflowIds', workflowIds.join(','))
        }

        if (folderIds.length > 0) {
          params.set('folderIds', folderIds.join(','))
        }

        if (triggers.length > 0) {
          params.set('triggers', triggers.join(','))
        }

        const response = await fetch(
          `/api/workspaces/${workspaceId}/metrics/executions?${params.toString()}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch execution history')
        }

        const data = await response.json()
        const mapped: WorkflowExecution[] = (data.workflows || []).map((wf: any) => {
          const segments = (wf.segments || []).map((s: any) => {
            const total = s.totalExecutions || 0
            const success = s.successfulExecutions || 0
            const hasExecutions = total > 0
            const successRate = hasExecutions ? (success / total) * 100 : 100
            return {
              timestamp: s.timestamp,
              hasExecutions,
              totalExecutions: total,
              successfulExecutions: success,
              successRate,
              avgDurationMs: typeof s.avgDurationMs === 'number' ? s.avgDurationMs : 0,
              p50Ms: typeof s.p50Ms === 'number' ? s.p50Ms : 0,
              p90Ms: typeof s.p90Ms === 'number' ? s.p90Ms : 0,
              p99Ms: typeof s.p99Ms === 'number' ? s.p99Ms : 0,
            }
          })
          const totals = segments.reduce(
            (acc: { total: number; success: number }, seg: (typeof segments)[number]) => {
              acc.total += seg.totalExecutions
              acc.success += seg.successfulExecutions
              return acc
            },
            { total: 0, success: 0 }
          )
          const overallSuccessRate = totals.total > 0 ? (totals.success / totals.total) * 100 : 100
          return {
            workflowId: wf.workflowId,
            workflowName: wf.workflowName,
            segments,
            overallSuccessRate,
          } as WorkflowExecution
        })
        const sortedWorkflows = mapped.sort((a, b) => {
          const errA = a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
          const errB = b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
          return errB - errA
        })
        setExecutions(sortedWorkflows)

        const segmentsCount: number = Number(params.get('segments') || DEFAULT_SEGMENTS)
        const agg: { timestamp: string; totalExecutions: number; successfulExecutions: number }[] =
          Array.from({ length: segmentsCount }, (_, i) => {
            const base = startTime.getTime()
            const ts = new Date(base + Math.floor((i * (endTime.getTime() - base)) / segmentsCount))
            return {
              timestamp: ts.toISOString(),
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

        const errorRates = agg.map((s) => ({
          timestamp: s.timestamp,
          value: s.totalExecutions > 0 ? (1 - s.successfulExecutions / s.totalExecutions) * 100 : 0,
        }))
        const executionCounts = agg.map((s) => ({
          timestamp: s.timestamp,
          value: s.totalExecutions,
        }))

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
          mappedLogs = (logsData.data || []).map(mapToExecutionLog)
        }

        setGlobalDetails({
          errorRates,
          durations: [],
          executionCounts,
          logs: mappedLogs,
          allLogs: mappedLogs,
        })
        setGlobalLogsMeta({ offset: mappedLogs.length, hasMore: mappedLogs.length === 50 })
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

        if (triggers.length > 0) {
          params.set('triggers', triggers.join(','))
        }

        const response = await fetch(
          `/api/logs?${new URLSearchParams({
            limit: '50',
            offset: '0',
            workspaceId,
            startDate: startTime.toISOString(),
            endDate: endTime.toISOString(),
            order: 'desc',
            details: 'full',
            workflowIds: workflowId,
            ...(triggers.length > 0 ? { triggers: triggers.join(',') } : {}),
          }).toString()}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch workflow details')
        }

        const data = await response.json()
        const mappedLogs: ExecutionLog[] = (data.data || []).map(mapToExecutionLogAlt)

        setWorkflowDetails((prev) => ({
          ...prev,
          [workflowId]: {
            errorRates: [],
            durations: [],
            executionCounts: [],
            logs: mappedLogs,
            allLogs: mappedLogs,
            __meta: { offset: mappedLogs.length, hasMore: (data.data || []).length === 50 },
          },
        }))
      } catch (err) {
        console.error('Error fetching workflow details:', err)
      }
    },
    [workspaceId, endTime, getStartTime, triggers]
  )

  // Infinite scroll for details logs
  const loadMoreLogs = useCallback(
    async (workflowId: string) => {
      const details = (workflowDetails as any)[workflowId]
      if (!details) return
      if (details.__loading) return
      if (!details.__meta?.hasMore) return
      try {
        // mark loading to prevent duplicate fetches
        setWorkflowDetails((prev) => ({
          ...prev,
          [workflowId]: { ...(prev as any)[workflowId], __loading: true },
        }))
        const startTime = getStartTime()
        const offset = details.__meta.offset || 0
        const qp = new URLSearchParams({
          limit: '50',
          offset: String(offset),
          workspaceId,
          startDate: startTime.toISOString(),
          endDate: endTime.toISOString(),
          order: 'desc',
          details: 'full',
          workflowIds: workflowId,
        })
        if (triggers.length > 0) qp.set('triggers', triggers.join(','))
        const res = await fetch(`/api/logs?${qp.toString()}`)
        if (!res.ok) return
        const data = await res.json()
        const more: ExecutionLog[] = (data.data || []).map(mapToExecutionLogAlt)

        setWorkflowDetails((prev) => {
          const cur = prev[workflowId]
          const seen = new Set<string>()
          const dedup = [...(cur?.allLogs || []), ...more].filter((x) => {
            const id = x.id
            if (seen.has(id)) return false
            seen.add(id)
            return true
          })
          return {
            ...prev,
            [workflowId]: {
              ...cur,
              logs: dedup,
              allLogs: dedup,
              __meta: {
                offset: (cur?.__meta?.offset || 0) + more.length,
                hasMore: more.length === 50,
              },
              __loading: false,
            },
          }
        })
      } catch {
        setWorkflowDetails((prev) => ({
          ...prev,
          [workflowId]: { ...(prev as any)[workflowId], __loading: false },
        }))
      }
    },
    [workspaceId, endTime, getStartTime, triggers, workflowDetails]
  )

  const loadMoreGlobalLogs = useCallback(async () => {
    if (!globalDetails || !globalLogsMeta.hasMore) return
    if (globalLoadingMore) return
    try {
      setGlobalLoadingMore(true)
      const startTime = getStartTime()
      const qp = new URLSearchParams({
        limit: '50',
        offset: String(globalLogsMeta.offset || 0),
        workspaceId,
        startDate: startTime.toISOString(),
        endDate: endTime.toISOString(),
        order: 'desc',
        details: 'full',
      })
      if (workflowIds.length > 0) qp.set('workflowIds', workflowIds.join(','))
      if (folderIds.length > 0) qp.set('folderIds', folderIds.join(','))
      if (triggers.length > 0) qp.set('triggers', triggers.join(','))

      const res = await fetch(`/api/logs?${qp.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      const more: ExecutionLog[] = (data.data || []).map(mapToExecutionLog)

      setGlobalDetails((prev) => {
        if (!prev) return prev
        const seen = new Set<string>()
        const dedup = [...prev.allLogs, ...more].filter((x) => {
          const id = x.id
          if (seen.has(id)) return false
          seen.add(id)
          return true
        })
        return { ...prev, logs: dedup, allLogs: dedup }
      })
      setGlobalLogsMeta((m) => ({
        offset: (m.offset || 0) + more.length,
        hasMore: more.length === 50,
      }))
    } catch {
      // ignore
    } finally {
      setGlobalLoadingMore(false)
    }
  }, [
    globalDetails,
    globalLogsMeta,
    globalLoadingMore,
    workspaceId,
    endTime,
    getStartTime,
    workflowIds,
    folderIds,
    triggers,
  ])

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
      if (expandedWorkflowId !== workflowId) {
        setExpandedWorkflowId(workflowId)
        if (!workflowDetails[workflowId]) {
          fetchWorkflowDetails(workflowId)
        }
        setSelectedSegmentIndices([segmentIndex])
        setLastAnchorIndex(segmentIndex)
      } else {
        setSelectedSegmentIndices((prev) => {
          if (mode === 'single') {
            setLastAnchorIndex(segmentIndex)
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

  const isInitialMount = useRef(true)
  useEffect(() => {
    const isInitial = isInitialMount.current
    if (isInitial) {
      isInitialMount.current = false
    }
    fetchExecutions(isInitial)
  }, [workspaceId, timeFilter, endTime, workflowIds, folderIds, triggers, segmentCount])

  useEffect(() => {
    if (expandedWorkflowId) {
      fetchWorkflowDetails(expandedWorkflowId)
    }
  }, [expandedWorkflowId, timeFilter, endTime, workflowIds, folderIds, fetchWorkflowDetails])

  useEffect(() => {
    setSelectedSegmentIndices([])
    setLastAnchorIndex(null)
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

  // Infinite scroll is now handled inside WorkflowDetails

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
                          ...log,
                          workflowName: (log as any).workflowName || wf.workflowName,
                        }))

                      const minStart = new Date(Math.min(...windows.map((w) => w.start)))
                      const maxEnd = new Date(Math.max(...windows.map((w) => w.end)))

                      // Build series from selected segments indices
                      const idxSet = new Set(selectedSegmentIndices)
                      const selectedSegs = wf.segments.filter((_, i) => idxSet.has(i))
                      ;(details as any).__filtered = buildSeriesFromSegments(selectedSegs as any)
                    }

                    const detailsWithFilteredLogs = details
                      ? {
                          ...details,
                          logs: logsToDisplay,
                          ...(() => {
                            const series =
                              (details as any).__filtered ||
                              buildSeriesFromSegments(wf.segments as any)
                            return {
                              errorRates: series.errorRates,
                              durations: series.durations,
                              executionCounts: series.executionCounts,
                              durationP50: series.durationP50,
                              durationP90: series.durationP90,
                              durationP99: series.durationP99,
                            }
                          })(),
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
                        onLoadMore={() => loadMoreLogs(expandedWorkflowId)}
                        hasMore={(workflowDetails as any)[expandedWorkflowId]?.__meta?.hasMore}
                        isLoadingMore={(workflowDetails as any)[expandedWorkflowId]?.__loading}
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
                      clearSegmentSelection={() => {
                        setSelectedSegmentIndices([])
                        setLastAnchorIndex(null)
                      }}
                      formatCost={formatCost}
                      onLoadMore={loadMoreGlobalLogs}
                      hasMore={globalLogsMeta.hasMore}
                      isLoadingMore={globalLoadingMore}
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
