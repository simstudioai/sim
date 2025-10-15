'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Loader2,
  RotateCcw,
  Search,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils/format-date'
import { formatCost } from '@/providers/utils'
import { useFilterStore } from '@/stores/logs/filters/store'

type TimeFilter = '1w' | '24h' | '12h' | '1h'

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

const BAR_COUNT = 120

function StatusBar({
  segments,
  selectedSegmentIndex,
  onSegmentClick,
  workflowId,
}: {
  segments: {
    successRate: number
    hasExecutions: boolean
    totalExecutions: number
    successfulExecutions: number
    timestamp: string
  }[]
  selectedSegmentIndex: number | null
  onSegmentClick: (workflowId: string, index: number, timestamp: string) => void
  workflowId: string
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <div className='flex items-center gap-[1px]'>
        {segments.map((segment, i) => {
          let color: string
          let tooltipContent: React.ReactNode
          const isSelected = selectedSegmentIndex === i

          if (!segment.hasExecutions) {
            color = 'bg-gray-300 dark:bg-gray-600'
            tooltipContent = (
              <div className='text-center'>
                <div className='font-medium'>No executions</div>
              </div>
            )
          } else {
            if (segment.successRate === 100) {
              color = 'bg-emerald-500'
            } else if (segment.successRate >= 95) {
              color = 'bg-amber-500'
            } else {
              color = 'bg-red-500'
            }

            tooltipContent = (
              <div className='text-center'>
                <div className='font-semibold'>{segment.successRate.toFixed(1)}%</div>
                <div className='mt-1 text-xs'>
                  {segment.successfulExecutions ?? 0}/{segment.totalExecutions ?? 0} executions
                  succeeded
                </div>
                <div className='mt-1 text-muted-foreground text-xs'>Click to filter</div>
              </div>
            )
          }

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={`h-6 w-2 rounded-[1px] ${color} cursor-pointer transition-all hover:opacity-80 ${
                    isSelected ? 'relative z-10 ring-2 ring-primary ring-offset-1' : 'relative z-0'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSegmentClick(workflowId, i, segment.timestamp)
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side='top' className='px-3 py-2'>
                {tooltipContent}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

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
}

interface WorkflowDetails {
  errorRates: { timestamp: string; value: number }[]
  durations: { timestamp: string; value: number }[]
  executionCounts: { timestamp: string; value: number }[]
  logs: ExecutionLog[]
  allLogs: ExecutionLog[] // Unfiltered logs for time filtering
}

function LineChart({
  data,
  label,
  color,
  unit,
}: {
  data: { timestamp: string; value: number }[]
  label: string
  color: string
  unit?: string
}) {
  const width = 400
  const height = 180
  const padding = { top: 20, right: 20, bottom: 25, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  if (data.length === 0) {
    return (
      <div
        className='flex items-center justify-center rounded-lg border bg-card p-4'
        style={{ width, height }}
      >
        <p className='text-muted-foreground text-sm'>No data</p>
      </div>
    )
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const minValue = Math.min(...data.map((d) => d.value), 0)
  const valueRange = maxValue - minValue || 1

  const points = data
    .map((d, i) => {
      const x = padding.left + (i / (data.length - 1 || 1)) * chartWidth
      const y = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className='rounded-lg border bg-card p-4 shadow-sm'>
      <h4 className='mb-3 font-semibold text-foreground text-sm'>{label}</h4>
      <TooltipProvider delayDuration={0}>
        <svg width={width} height={height} className='overflow-visible'>
          {/* Y-axis */}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={height - padding.bottom}
            stroke='hsl(var(--border))'
            strokeWidth='1'
          />
          {/* X-axis */}
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke='hsl(var(--border))'
            strokeWidth='1'
          />

          {/* Line */}
          <polyline
            points={points}
            fill='none'
            stroke={color}
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          />

          {/* Points */}
          {data.map((d, i) => {
            const x = padding.left + (i / (data.length - 1 || 1)) * chartWidth
            const y = padding.top + chartHeight - ((d.value - minValue) / valueRange) * chartHeight
            const timestamp = new Date(d.timestamp)
            const timeStr = timestamp.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <circle
                    cx={x}
                    cy={y}
                    r='4'
                    fill={color}
                    className='hover:r-6 cursor-pointer transition-all'
                    style={{ pointerEvents: 'all' }}
                  />
                </TooltipTrigger>
                <TooltipContent side='top' className='px-3 py-2'>
                  <div className='text-center'>
                    <div className='font-semibold text-xs'>{timeStr}</div>
                    <div className='mt-1 text-sm'>
                      {d.value.toFixed(2)}
                      {unit || ''}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}

          {/* Y-axis labels */}
          <text
            x={padding.left - 10}
            y={padding.top}
            textAnchor='end'
            fontSize='10'
            fill='hsl(var(--muted-foreground))'
          >
            {maxValue.toFixed(1)}
            {unit}
          </text>
          <text
            x={padding.left - 10}
            y={height - padding.bottom}
            textAnchor='end'
            fontSize='10'
            fill='hsl(var(--muted-foreground))'
          >
            {minValue.toFixed(1)}
            {unit}
          </text>
        </svg>
      </TooltipProvider>
    </div>
  )
}

export default function ExecutionsDashboard() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  // Map sidebar timeRange to our timeFilter
  const getTimeFilterFromRange = (range: string): TimeFilter => {
    switch (range) {
      case 'Past 30 minutes':
      case 'Past hour':
        return '1h'
      case 'Past 12 hours':
        return '12h'
      case 'Past 24 hours':
        return '24h'
      default:
        return '24h'
    }
  }
  const [endTime, setEndTime] = useState<Date>(new Date())
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefetching, setIsRefetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowDetails>>({})
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null)
  const [selectedSegmentTimestamp, setSelectedSegmentTimestamp] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const {
    workflowIds,
    folderIds,
    triggers,
    viewMode,
    setViewMode,
    timeRange: sidebarTimeRange,
  } = useFilterStore()

  const timeFilter = getTimeFilterFromRange(sidebarTimeRange)

  // Filter executions based on search query
  const filteredExecutions = searchQuery.trim()
    ? executions.filter((workflow) =>
        workflow.workflowName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : executions

  const getStartTime = useCallback(() => {
    const start = new Date(endTime)

    switch (timeFilter) {
      case '1w':
        start.setDate(endTime.getDate() - 7)
        break
      case '24h':
        start.setHours(endTime.getHours() - 24)
        break
      case '12h':
        start.setHours(endTime.getHours() - 12)
        break
      case '1h':
        start.setHours(endTime.getHours() - 1)
        break
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
          segments: BAR_COUNT.toString(),
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
      } catch (err) {
        console.error('Error fetching executions:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
        setIsRefetching(false)
      }
    },
    [workspaceId, timeFilter, endTime, getStartTime, workflowIds, folderIds, triggers]
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
        setSelectedSegmentIndex(null)
        setSelectedSegmentTimestamp(null)
      } else {
        setExpandedWorkflowId(workflowId)
        setSelectedSegmentIndex(null)
        setSelectedSegmentTimestamp(null)
        if (!workflowDetails[workflowId]) {
          fetchWorkflowDetails(workflowId)
        }
      }
    },
    [expandedWorkflowId, workflowDetails, fetchWorkflowDetails]
  )

  const handleSegmentClick = useCallback(
    (workflowId: string, segmentIndex: number, timestamp: string) => {
      // Open the workflow details if not already open
      if (expandedWorkflowId !== workflowId) {
        setExpandedWorkflowId(workflowId)
        if (!workflowDetails[workflowId]) {
          fetchWorkflowDetails(workflowId)
        }
        // Select the segment when opening a new workflow
        setSelectedSegmentIndex(segmentIndex)
        setSelectedSegmentTimestamp(timestamp)
      } else {
        // If clicking the same segment again, deselect it
        if (selectedSegmentIndex === segmentIndex) {
          setSelectedSegmentIndex(null)
          setSelectedSegmentTimestamp(null)
        } else {
          // Select the new segment
          setSelectedSegmentIndex(segmentIndex)
          setSelectedSegmentTimestamp(timestamp)
        }
      }
    },
    [expandedWorkflowId, workflowDetails, fetchWorkflowDetails, selectedSegmentIndex]
  )

  // Initial load
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      fetchExecutions(true)
      isInitialMount.current = false
    } else {
      fetchExecutions(false)
    }
  }, [fetchExecutions])

  // Refetch workflow details when time, filters, or expanded workflow changes
  useEffect(() => {
    if (expandedWorkflowId) {
      fetchWorkflowDetails(expandedWorkflowId)
    }
  }, [expandedWorkflowId, timeFilter, endTime, workflowIds, folderIds, fetchWorkflowDetails])

  // Clear segment selection when time or filters change
  useEffect(() => {
    setSelectedSegmentIndex(null)
    setSelectedSegmentTimestamp(null)
  }, [timeFilter, endTime, workflowIds, folderIds, triggers])

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
    const shift =
      timeFilter === '1h'
        ? 60 * 60 * 1000
        : timeFilter === '12h'
          ? 12 * 60 * 60 * 1000
          : timeFilter === '24h'
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000 // 1w

    setEndTime((prev) => new Date(prev.getTime() + (direction === 'forward' ? shift : -shift)))
  }

  const resetToNow = () => {
    setEndTime(new Date())
  }

  const isLive = endTime.getTime() > Date.now() - 60000 // Within last minute

  const { timeRange } = useFilterStore()

  return (
    <div className='flex h-full min-w-0 flex-col pl-64'>
      <div className='flex min-w-0 flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto p-6'>
          {/* Controls */}
          <div className='mb-8 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start'>
            {/* Search Bar */}
            <div className='relative w-full max-w-md'>
              <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-[18px] w-[18px] text-muted-foreground' />
              <Input
                type='text'
                placeholder='Search workflows...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='h-9 w-full rounded-[11px] border-[#E5E5E5] bg-[#FFFFFF] pr-10 pl-9 dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className='-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground'
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 16 16'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                  >
                    <path d='M12 4L4 12M4 4l8 8' />
                  </svg>
                </button>
              )}
            </div>

            <div className='ml-auto flex flex-shrink-0 items-center gap-3'>
              {/* View Mode Toggle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className='flex items-center rounded-[11px] border bg-card p-2'>
                    <Switch
                      checked={(viewMode as string) === 'dashboard'}
                      onCheckedChange={(checked) => setViewMode(checked ? 'dashboard' : 'logs')}
                      className='data-[state=checked]:bg-primary'
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {(viewMode as string) === 'dashboard'
                    ? 'Switch to logs view'
                    : 'Switch to executions dashboard'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

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
              {/* Time Range Display */}
              <div className='mb-4 flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <span className='font-medium text-muted-foreground text-sm'>
                    {getDateRange()}
                  </span>
                  {!isLive && (
                    <span className='inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-600 text-xs dark:text-amber-400'>
                      Historical
                    </span>
                  )}
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

                {/* Time Navigation Controls - Far Right */}
                <div className='flex items-center gap-1'>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='outline'
                        size='icon'
                        onClick={() => shiftTimeWindow('back')}
                        className='h-7 w-7'
                      >
                        <ChevronLeft className='h-3.5 w-3.5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Previous {getShiftLabel()}</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='outline'
                        size='icon'
                        onClick={resetToNow}
                        disabled={isLive}
                        className='h-7 w-7'
                      >
                        <RotateCcw className='h-3.5 w-3.5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Jump to now</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='outline'
                        size='icon'
                        onClick={() => shiftTimeWindow('forward')}
                        disabled={isLive}
                        className='h-7 w-7'
                      >
                        <ChevronRight className='h-3.5 w-3.5' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Next {getShiftLabel()}</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div
                className='overflow-hidden rounded-lg border bg-card shadow-sm'
                style={{ maxHeight: '350px', display: 'flex', flexDirection: 'column' }}
              >
                <div className='flex-shrink-0 border-b bg-muted/30 px-4 py-2.5'>
                  <div className='flex items-center justify-between'>
                    <h3 className='font-medium text-sm'>Workflows</h3>
                    <span className='text-muted-foreground text-xs'>
                      {filteredExecutions.length} workflow
                      {filteredExecutions.length !== 1 ? 's' : ''}
                      {searchQuery && ` (filtered from ${executions.length})`}
                    </span>
                  </div>
                </div>
                <ScrollArea className='flex-1' style={{ height: 'calc(350px - 41px)' }}>
                  <div className='space-y-1 p-3'>
                    {filteredExecutions.length === 0 ? (
                      <div className='py-8 text-center text-muted-foreground text-sm'>
                        No workflows found matching "{searchQuery}"
                      </div>
                    ) : (
                      filteredExecutions.map((workflow) => {
                        const isSelected = expandedWorkflowId === workflow.workflowId

                        return (
                          <div
                            key={workflow.workflowId}
                            className={`flex cursor-pointer items-center gap-4 rounded-lg px-2 py-1.5 transition-colors ${
                              isSelected ? 'bg-accent/40' : 'hover:bg-accent/20'
                            }`}
                            onClick={() => toggleWorkflow(workflow.workflowId)}
                          >
                            <div className='w-52 min-w-0 flex-shrink-0'>
                              <h3
                                className='truncate font-medium text-sm transition-colors hover:text-primary'
                                title={workflow.workflowName}
                              >
                                {workflow.workflowName}
                              </h3>
                            </div>

                            <div className='flex-1'>
                              <StatusBar
                                segments={workflow.segments}
                                selectedSegmentIndex={isSelected ? selectedSegmentIndex : null}
                                onSegmentClick={handleSegmentClick}
                                workflowId={workflow.workflowId}
                              />
                            </div>

                            <div className='w-16 flex-shrink-0 text-right'>
                              <span className='font-medium text-muted-foreground text-sm'>
                                {workflow.overallSuccessRate.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Details section below the entire bars component */}
              {expandedWorkflowId && (
                <div className='mt-6 rounded-lg border bg-card shadow-sm'>
                  <div className='border-b bg-muted/30 px-6 py-4'>
                    <div className='flex items-center gap-2'>
                      <h3 className='font-semibold text-lg tracking-tight'>
                        {executions.find((w) => w.workflowId === expandedWorkflowId)?.workflowName}
                      </h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() =>
                              router.push(`/workspace/${workspaceId}/w/${expandedWorkflowId}`)
                            }
                            className='rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                          >
                            <ExternalLink className='h-4 w-4' />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Open workflow</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className='p-6'>
                    {workflowDetails[expandedWorkflowId] ? (
                      <>
                        {/* Filter info banner */}
                        {selectedSegmentIndex !== null &&
                          (() => {
                            const workflow = executions.find(
                              (w) => w.workflowId === expandedWorkflowId
                            )
                            const segment = workflow?.segments[selectedSegmentIndex]
                            if (!segment) return null

                            const segmentStart = new Date(segment.timestamp)
                            const timeRangeMs =
                              timeFilter === '1h'
                                ? 60 * 60 * 1000
                                : timeFilter === '12h'
                                  ? 12 * 60 * 60 * 1000
                                  : timeFilter === '24h'
                                    ? 24 * 60 * 60 * 1000
                                    : 7 * 24 * 60 * 60 * 1000
                            const segmentDurationMs = timeRangeMs / BAR_COUNT
                            const segmentEnd = new Date(segmentStart.getTime() + segmentDurationMs)

                            const formatOptions: Intl.DateTimeFormatOptions = {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true,
                            }

                            const startStr = segmentStart.toLocaleString('en-US', formatOptions)
                            const endStr = segmentEnd.toLocaleString('en-US', formatOptions)

                            return (
                              <div className='mb-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm'>
                                <div className='flex items-center gap-2'>
                                  <div className='h-2 w-2 animate-pulse rounded-full bg-primary' />
                                  <span className='font-medium text-primary'>
                                    Filtered to {startStr} — {endStr} ({segment.totalExecutions}{' '}
                                    execution{segment.totalExecutions !== 1 ? 's' : ''})
                                  </span>
                                </div>
                                <button
                                  onClick={() => {
                                    setSelectedSegmentIndex(null)
                                    setSelectedSegmentTimestamp(null)
                                  }}
                                  className='text-primary text-xs hover:underline'
                                >
                                  Clear filter
                                </button>
                              </div>
                            )
                          })()}

                        <div className='mb-6 grid grid-cols-3 gap-6'>
                          <LineChart
                            data={workflowDetails[expandedWorkflowId].errorRates}
                            label='Error Rate'
                            color='#ef4444'
                            unit='%'
                          />
                          <LineChart
                            data={workflowDetails[expandedWorkflowId].durations}
                            label='Workflow Duration'
                            color='#3b82f6'
                            unit='ms'
                          />
                          <LineChart
                            data={workflowDetails[expandedWorkflowId].executionCounts}
                            label='Usage'
                            color='#10b981'
                            unit=' execs'
                          />
                        </div>

                        {/* Logs Table */}
                        <TooltipProvider delayDuration={0}>
                          <div className='flex flex-1 flex-col overflow-hidden'>
                            {/* Table header */}
                            <div className='w-full overflow-x-auto'>
                              <div>
                                <div className='border-border border-b'>
                                  <div className='grid min-w-[700px] grid-cols-[140px_90px_100px_90px_100px_1fr_90px] gap-2 px-2 pb-3 md:gap-3 lg:min-w-0 lg:gap-4'>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      Time
                                    </div>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      Status
                                    </div>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      Trigger
                                    </div>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      Cost
                                    </div>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      User
                                    </div>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      Output
                                    </div>
                                    <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                                      Duration
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Table body - scrollable */}
                            <div className='flex-1 overflow-auto' style={{ maxHeight: '400px' }}>
                              <div className='pb-4'>
                                {(() => {
                                  const details = workflowDetails[expandedWorkflowId]
                                  let logsToDisplay = details.logs

                                  // Filter logs if a segment is selected
                                  if (selectedSegmentIndex !== null && selectedSegmentTimestamp) {
                                    const workflow = executions.find(
                                      (w) => w.workflowId === expandedWorkflowId
                                    )
                                    if (workflow?.segments[selectedSegmentIndex]) {
                                      const segment = workflow.segments[selectedSegmentIndex]
                                      const segmentStart = new Date(segment.timestamp)

                                      // Calculate segment duration based on time filter
                                      const timeRangeMs =
                                        timeFilter === '1h'
                                          ? 60 * 60 * 1000
                                          : timeFilter === '12h'
                                            ? 12 * 60 * 60 * 1000
                                            : timeFilter === '24h'
                                              ? 24 * 60 * 60 * 1000
                                              : 7 * 24 * 60 * 60 * 1000 // 1w
                                      const segmentDurationMs = timeRangeMs / BAR_COUNT
                                      const segmentEnd = new Date(
                                        segmentStart.getTime() + segmentDurationMs
                                      )

                                      // Filter logs to only those within this segment
                                      logsToDisplay = details.allLogs.filter((log) => {
                                        const logTime = new Date(log.startedAt).getTime()
                                        return (
                                          logTime >= segmentStart.getTime() &&
                                          logTime < segmentEnd.getTime()
                                        )
                                      })
                                    }
                                  }

                                  if (logsToDisplay.length === 0) {
                                    return (
                                      <div className='flex h-full items-center justify-center py-8'>
                                        <div className='flex items-center gap-2 text-muted-foreground'>
                                          <Info className='h-5 w-5' />
                                          <span className='text-sm'>
                                            No executions found in this time segment
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  }

                                  return logsToDisplay.map((log) => {
                                    const logDate = new Date(log.startedAt)
                                    const formattedDate = formatDate(logDate.toISOString())
                                    const outputsStr = log.outputs
                                      ? JSON.stringify(log.outputs)
                                      : '—'
                                    const errorStr = log.errorMessage || ''

                                    return (
                                      <div
                                        key={log.id}
                                        className='cursor-pointer border-border border-b transition-all duration-200 hover:bg-accent/20'
                                      >
                                        <div className='grid min-w-[700px] grid-cols-[140px_90px_100px_90px_100px_1fr_90px] items-center gap-2 px-2 py-4 md:gap-3 lg:min-w-0 lg:gap-4'>
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

                                          {/* Trigger */}
                                          <div>
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
                                                    : {
                                                        backgroundColor: getTriggerColor(
                                                          log.trigger
                                                        ),
                                                      }
                                                }
                                              >
                                                {log.trigger}
                                              </div>
                                            ) : (
                                              <div className='text-muted-foreground text-xs'>—</div>
                                            )}
                                          </div>

                                          {/* Cost */}
                                          <div>
                                            <div className='font-medium text-muted-foreground text-xs'>
                                              {log.cost && log.cost.total > 0
                                                ? formatCost(log.cost.total)
                                                : '—'}
                                            </div>
                                          </div>

                                          {/* User */}
                                          <div>
                                            <div className='text-muted-foreground text-xs'>
                                              {log.triggerUserId || '—'}
                                            </div>
                                          </div>

                                          {/* Output */}
                                          <div className='min-w-0'>
                                            <Tooltip delayDuration={0}>
                                              <TooltipTrigger asChild>
                                                <div
                                                  className={cn(
                                                    'cursor-default truncate text-[13px]',
                                                    log.level === 'error' && errorStr
                                                      ? 'font-medium text-red-600 dark:text-red-400'
                                                      : 'text-muted-foreground'
                                                  )}
                                                >
                                                  {log.level === 'error' && errorStr
                                                    ? errorStr
                                                    : outputsStr}
                                                </div>
                                              </TooltipTrigger>
                                              <TooltipContent
                                                side='bottom'
                                                align='start'
                                                className='max-w-lg px-3 py-2'
                                              >
                                                <pre
                                                  className={cn(
                                                    'whitespace-pre-wrap break-words text-xs',
                                                    log.level === 'error' &&
                                                      errorStr &&
                                                      'text-red-600 dark:text-red-400'
                                                  )}
                                                >
                                                  {log.level === 'error' && errorStr
                                                    ? errorStr
                                                    : outputsStr}
                                                </pre>
                                              </TooltipContent>
                                            </Tooltip>
                                          </div>

                                          {/* Duration */}
                                          <div>
                                            <div className='text-muted-foreground text-xs'>
                                              {log.duration ? `${log.duration}ms` : '—'}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })
                                })()}
                              </div>
                            </div>
                          </div>
                        </TooltipProvider>
                      </>
                    ) : (
                      <div className='flex items-center justify-center py-12'>
                        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
