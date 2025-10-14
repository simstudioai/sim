'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatCost } from '@/providers/utils'

type TimeFilter = '1w' | '24h' | '12h' | '1h'

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
}: {
  segments: {
    successRate: number
    hasExecutions: boolean
    totalExecutions: number
    successfulExecutions: number
    timestamp: string
  }[]
  selectedSegmentIndex: number | null
  onSegmentClick: (index: number, timestamp: string) => void
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
                <div className='mt-1 text-xs text-muted-foreground'>Click to filter</div>
              </div>
            )
          }

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={`h-6 w-2 rounded-[1px] ${color} cursor-pointer transition-all hover:opacity-80 ${
                    isSelected ? 'ring-2 ring-primary ring-offset-1' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSegmentClick(i, segment.timestamp)
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
  const height = 200
  const padding = { top: 20, right: 20, bottom: 30, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  if (data.length === 0) {
    return (
      <div className='flex items-center justify-center' style={{ width, height }}>
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
    <div className='rounded-lg border bg-card p-4'>
      <h4 className='mb-3 font-medium text-sm'>{label}</h4>
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
  const workspaceId = params.workspaceId as string

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('24h')
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowDetails>>({})
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null)
  const [selectedSegmentTimestamp, setSelectedSegmentTimestamp] = useState<string | null>(null)

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(
        `/api/workspaces/${workspaceId}/execution-history?timeFilter=${timeFilter}&segments=${BAR_COUNT}`
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
    }
  }, [workspaceId, timeFilter])

  const fetchWorkflowDetails = useCallback(
    async (workflowId: string) => {
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/execution-history/${workflowId}?timeFilter=${timeFilter}`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch workflow details')
        }

        const data = await response.json()
        // Store both filtered and all logs
        setWorkflowDetails((prev) => ({ 
          ...prev, 
          [workflowId]: { 
            ...data, 
            allLogs: data.logs // Keep a copy of all logs for filtering
          } 
        }))
      } catch (err) {
        console.error('Error fetching workflow details:', err)
      }
    },
    [workspaceId, timeFilter]
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

  const handleSegmentClick = useCallback((segmentIndex: number, timestamp: string) => {
    setSelectedSegmentIndex(segmentIndex)
    setSelectedSegmentTimestamp(timestamp)
  }, [])

  useEffect(() => {
    fetchExecutions()
    // Clear cached workflow details when time filter changes
    setWorkflowDetails({})
    setExpandedWorkflowId(null)
    setSelectedSegmentIndex(null)
    setSelectedSegmentTimestamp(null)
  }, [fetchExecutions])

  const getTimeFilterLabel = (filter: TimeFilter) => {
    switch (filter) {
      case '1w':
        return '1 Week'
      case '24h':
        return '24 Hours'
      case '12h':
        return '12 Hours'
      case '1h':
        return '1 Hour'
    }
  }

  const getDateRange = () => {
    const now = new Date()
    const start = new Date()

    switch (timeFilter) {
      case '1w':
        start.setDate(now.getDate() - 7)
        break
      case '24h':
        start.setHours(now.getHours() - 24)
        break
      case '12h':
        start.setHours(now.getHours() - 12)
        break
      case '1h':
        start.setHours(now.getHours() - 1)
        break
    }

    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }

  return (
    <div className='flex h-full flex-col p-6 pl-64'>
      {/* Header */}
      <div className='mb-6'>
        <div className='mb-4 flex items-center justify-between'>
          <div>
            <h2 className='font-semibold text-2xl'>Execution History</h2>
            <p className='mt-1 text-muted-foreground text-sm'>
              Monitor workflow execution success rates over time
            </p>
          </div>

          {/* Time Filters */}
          <div className='flex gap-2'>
            {(['1h', '12h', '24h', '1w'] as TimeFilter[]).map((filter) => (
              <Button
                key={filter}
                variant={timeFilter === filter ? 'default' : 'outline'}
                size='sm'
                onClick={() => setTimeFilter(filter)}
              >
                {getTimeFilterLabel(filter)}
              </Button>
            ))}
          </div>
        </div>

        <div className='text-muted-foreground text-sm'>{getDateRange()}</div>
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
          <div className='overflow-hidden rounded-lg border bg-card' style={{ maxHeight: '350px' }}>
            <ScrollArea className='h-full'>
              <div className='space-y-1 p-3'>
                {executions.map((workflow) => {
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
                        />
                      </div>

                      <div className='w-16 flex-shrink-0 text-right'>
                        <span className='font-medium text-muted-foreground text-sm'>
                          {workflow.overallSuccessRate.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Details section below the entire bars component */}
          {expandedWorkflowId && (
            <div className='mt-6 rounded-lg border bg-card p-6'>
              <div className='mb-4'>
                <h3 className='font-semibold text-lg'>
                  {executions.find((w) => w.workflowId === expandedWorkflowId)?.workflowName}
                </h3>
                <p className='mt-1 text-muted-foreground text-sm'>Detailed execution metrics</p>
              </div>

              {!workflowDetails[expandedWorkflowId] ? (
                <div className='flex items-center justify-center py-12'>
                  <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
                </div>
              ) : (
                <>
                  {/* Filter info banner */}
                  {selectedSegmentIndex !== null && (
                    <div className='mb-4 flex items-center justify-between rounded-lg bg-primary/10 px-4 py-2 text-sm'>
                      <span className='text-primary'>
                        Showing executions from selected time segment
                      </span>
                      <button
                        onClick={() => {
                          setSelectedSegmentIndex(null)
                          setSelectedSegmentTimestamp(null)
                        }}
                        className='text-primary hover:underline'
                      >
                        Clear filter
                      </button>
                    </div>
                  )}
                  
                  <div className='mb-6 grid grid-cols-3 gap-6'>
                    <LineChart
                      data={workflowDetails[expandedWorkflowId].errorRates}
                      label='Error Rate Over Time'
                      color='#ef4444'
                      unit='%'
                    />
                    <LineChart
                      data={workflowDetails[expandedWorkflowId].durations}
                      label='Workflow Duration Over Time'
                      color='#3b82f6'
                      unit='ms'
                    />
                    <LineChart
                      data={workflowDetails[expandedWorkflowId].executionCounts}
                      label='Usage Over Time'
                      color='#10b981'
                      unit=' execs'
                    />
                  </div>

                  {/* Logs Table */}
                  <TooltipProvider delayDuration={0}>
                    <div className='overflow-hidden rounded-lg border'>
                      <div className='border-b bg-muted/30 px-4 py-2'>
                        <h4 className='font-medium text-sm'>Execution Logs</h4>
                      </div>
                      <div className='overflow-x-auto'>
                        <table className='w-full text-sm'>
                           <thead className='border-b bg-muted/20 font-medium text-muted-foreground text-xs'>
                             <tr>
                               <th className='w-[140px] px-4 py-2 text-left'>Time</th>
                               <th className='w-[80px] px-4 py-2 text-left'>Status</th>
                               <th className='w-[100px] px-4 py-2 text-left'>Trigger</th>
                               <th className='w-[120px] px-4 py-2 text-left'>User</th>
                               <th className='px-4 py-2 text-left'>Inputs</th>
                               <th className='px-4 py-2 text-left'>Outputs</th>
                               <th className='w-[90px] px-4 py-2 text-left'>Cost</th>
                             </tr>
                           </thead>
                          <tbody className='divide-y'>
                            {(() => {
                              const details = workflowDetails[expandedWorkflowId]
                              let logsToDisplay = details.logs

                              // Filter logs if a segment is selected
                              if (selectedSegmentIndex !== null && selectedSegmentTimestamp) {
                                const workflow = executions.find((w) => w.workflowId === expandedWorkflowId)
                                if (workflow && workflow.segments[selectedSegmentIndex]) {
                                  const segment = workflow.segments[selectedSegmentIndex]
                                  const segmentStart = new Date(segment.timestamp)
                                  
                                  // Calculate segment duration based on time filter
                                  const timeRangeMs = 
                                    timeFilter === '1h' ? 60 * 60 * 1000 :
                                    timeFilter === '12h' ? 12 * 60 * 60 * 1000 :
                                    timeFilter === '24h' ? 24 * 60 * 60 * 1000 :
                                    7 * 24 * 60 * 60 * 1000 // 1w
                                  const segmentDurationMs = timeRangeMs / BAR_COUNT
                                  const segmentEnd = new Date(segmentStart.getTime() + segmentDurationMs)

                                  // Filter logs to only those within this segment
                                  logsToDisplay = details.allLogs.filter((log) => {
                                    const logTime = new Date(log.startedAt).getTime()
                                    return logTime >= segmentStart.getTime() && logTime < segmentEnd.getTime()
                                  })
                                }
                              }

                              return logsToDisplay.map((log) => {
                              const time = new Date(log.startedAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: true,
                              })

                              const inputsStr = log.triggerInputs
                                ? JSON.stringify(log.triggerInputs)
                                : '-'
                              const outputsStr = log.outputs ? JSON.stringify(log.outputs) : '-'
                              const truncateLength = 50

                              return (
                                <tr key={log.id} className='hover:bg-muted/10'>
                                  <td className='px-4 py-2 font-mono text-muted-foreground text-xs'>
                                    {time}
                                  </td>
                                  <td className='px-4 py-2'>
                                    <span
                                      className={`inline-flex items-center rounded-md px-2 py-0.5 font-medium text-xs ${
                                        log.level === 'error'
                                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                      }`}
                                    >
                                      {log.level === 'error' ? 'Error' : 'Success'}
                                    </span>
                                  </td>
                                  <td className='px-4 py-2'>
                                    <span className='inline-flex items-center rounded-md bg-secondary px-2 py-0.5 font-medium text-xs'>
                                      {log.trigger}
                                    </span>
                                  </td>
                                  <td className='px-4 py-2 text-muted-foreground'>
                                    {log.triggerUserId || '-'}
                                  </td>
                                  <td className='px-4 py-2'>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className='block max-w-[300px] cursor-default truncate text-muted-foreground text-xs'>
                                          {inputsStr.length > truncateLength
                                            ? `${inputsStr.substring(0, truncateLength)}...`
                                            : inputsStr}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side='top' className='max-w-lg'>
                                        <pre className='whitespace-pre-wrap break-words text-xs'>
                                          {inputsStr}
                                        </pre>
                                      </TooltipContent>
                                    </Tooltip>
                                  </td>
                                  <td className='px-4 py-2'>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          className={`block max-w-[300px] cursor-default truncate text-xs ${
                                            log.level === 'error' && log.errorMessage
                                              ? 'font-medium text-red-600 dark:text-red-400'
                                              : 'text-muted-foreground'
                                          }`}
                                        >
                                          {log.level === 'error' && log.errorMessage
                                            ? log.errorMessage.length > truncateLength
                                              ? `${log.errorMessage.substring(0, truncateLength)}...`
                                              : log.errorMessage
                                            : outputsStr.length > truncateLength
                                              ? `${outputsStr.substring(0, truncateLength)}...`
                                              : outputsStr}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side='top' className='max-w-lg'>
                                        <pre
                                          className={`whitespace-pre-wrap break-words text-xs ${
                                            log.level === 'error' && log.errorMessage
                                              ? 'text-red-600 dark:text-red-400'
                                              : ''
                                          }`}
                                        >
                                          {log.level === 'error' && log.errorMessage
                                            ? log.errorMessage
                                            : outputsStr}
                                        </pre>
                                      </TooltipContent>
                                     </Tooltip>
                                   </td>
                                   <td className='px-4 py-2'>
                                     {log.cost && log.cost.total > 0 ? (
                                       <Tooltip>
                                         <TooltipTrigger asChild>
                                           <span className='cursor-default font-mono text-muted-foreground text-xs'>
                                             {formatCost(log.cost.total)}
                                           </span>
                                         </TooltipTrigger>
                                         <TooltipContent side='top' className='px-3 py-2'>
                                           <div className='text-xs'>
                                             <div>Input: {formatCost(log.cost.input)}</div>
                                             <div>Output: {formatCost(log.cost.output)}</div>
                                             <div className='mt-1 border-t pt-1 font-semibold'>
                                               Total: {formatCost(log.cost.total)}
                                             </div>
                                           </div>
                                         </TooltipContent>
                                       </Tooltip>
                                     ) : (
                                       <span className='text-muted-foreground text-xs'>—</span>
                                     )}
                                   </td>
                                 </tr>
                               )
                             })
                            })()}
                           </tbody>
                        </table>
                      </div>
                    </div>
                  </TooltipProvider>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
