import { useMemo, useState } from 'react'
import { Info, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import LineChart, {
  type LineChartPoint,
} from '@/app/workspace/[workspaceId]/logs/components/dashboard/line-chart'
import { getTriggerColor } from '@/app/workspace/[workspaceId]/logs/components/dashboard/utils'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils/format-date'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export interface ExecutionLogItem {
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

export interface WorkflowDetailsData {
  errorRates: LineChartPoint[]
  durations?: LineChartPoint[]
  executionCounts: LineChartPoint[]
  logs: ExecutionLogItem[]
  allLogs: ExecutionLogItem[]
}

export function WorkflowDetails({
  workspaceId,
  expandedWorkflowId,
  workflowName,
  overview,
  details,
  selectedSegmentIndex,
  selectedSegment,
  clearSegmentSelection,
  formatCost,
}: {
  workspaceId: string
  expandedWorkflowId: string
  workflowName: string
  overview: { total: number; success: number; failures: number; rate: number }
  details: WorkflowDetailsData | undefined
  selectedSegmentIndex: number[] | null
  selectedSegment: { timestamp: string; totalExecutions: number } | null
  clearSegmentSelection: () => void
  formatCost: (n: number) => string
}) {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()
  const workflowColor = useMemo(
    () => workflows[expandedWorkflowId]?.color || '#3972F6',
    [workflows, expandedWorkflowId]
  )
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  return (
    <div className='mt-5 overflow-hidden rounded-[11px] border bg-card shadow-sm'>
      <div className='border-b bg-muted/30 px-4 py-2.5'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => router.push(`/workspace/${workspaceId}/w/${expandedWorkflowId}`)}
              className='group inline-flex items-center gap-2 text-left'
            >
              <span
                className='h-[14px] w-[14px] flex-shrink-0 rounded'
                style={{ backgroundColor: workflowColor }}
              />
              <span className='font-semibold text-sm tracking-tight group-hover:text-primary'>
                {workflowName}
              </span>
            </button>
          </div>
          <div className='flex items-center gap-2'>
            <div className='inline-flex h-7 items-center gap-2 rounded-[10px] border px-2.5'>
              <span className='text-[11px] text-muted-foreground'>Executions</span>
              <span className='font-semibold text-sm leading-none'>{overview.total}</span>
            </div>
            <div className='inline-flex h-7 items-center gap-2 rounded-[10px] border px-2.5'>
              <span className='text-[11px] text-muted-foreground'>Success</span>
              <span className='font-semibold text-sm leading-none'>
                {overview.rate.toFixed(1)}%
              </span>
            </div>
            <div className='inline-flex h-7 items-center gap-2 rounded-[10px] border px-2.5'>
              <span className='text-[11px] text-muted-foreground'>Failures</span>
              <span className='font-semibold text-sm leading-none'>{overview.failures}</span>
            </div>
          </div>
        </div>
      </div>
      <div className='p-4'>
        {details ? (
          <>
            {Array.isArray(selectedSegmentIndex) &&
              selectedSegmentIndex.length > 0 &&
              selectedSegment &&
              (() => {
                const tsObj = selectedSegment?.timestamp
                  ? new Date(selectedSegment.timestamp)
                  : null
                const tsLabel =
                  tsObj && !Number.isNaN(tsObj.getTime())
                    ? tsObj.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })
                    : 'Selected segment'
                return (
                  <div className='mb-4 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-foreground text-sm'>
                    <div className='flex items-center gap-2'>
                      <div className='h-2 w-2 animate-pulse rounded-full bg-primary ring-2 ring-primary/40' />
                      <span className='font-medium'>
                        Filtered to {tsLabel}
                        {selectedSegmentIndex.length > 1
                          ? ` (+${selectedSegmentIndex.length - 1} more segment${selectedSegmentIndex.length - 1 > 1 ? 's' : ''})`
                          : ''}
                        — {selectedSegment.totalExecutions} execution
                        {selectedSegment.totalExecutions !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={clearSegmentSelection}
                      className='rounded px-2 py-1 text-foreground text-xs hover:bg-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/50'
                    >
                      Clear filter
                    </button>
                  </div>
                )
              })()}

            {(() => {
              const hasDuration = Array.isArray(details.durations) && details.durations.length > 0
              const gridCols = hasDuration
                ? 'md:grid-cols-2 xl:grid-cols-4'
                : 'md:grid-cols-2 xl:grid-cols-3'
              return (
                <div className={`mb-4 grid grid-cols-1 gap-4 ${gridCols}`}>
                  <LineChart
                    data={details.errorRates}
                    label='Error Rate'
                    color='#ef4444'
                    unit='%'
                  />
                  {hasDuration && (
                    <LineChart
                      data={details.durations!}
                      label='Workflow Duration'
                      color='#3b82f6'
                      unit='ms'
                    />
                  )}
                  <LineChart
                    data={details.executionCounts}
                    label='Usage'
                    color='#10b981'
                    unit=' execs'
                  />
                  {(() => {
                    const failures = details.errorRates.map((e, i) => ({
                      timestamp: e.timestamp,
                      value: ((e.value || 0) / 100) * (details.executionCounts[i]?.value || 0),
                    }))
                    return <LineChart data={failures} label='Failures' color='#f59e0b' unit='' />
                  })()}
                </div>
              )
            })()}

            <div className='flex flex-1 flex-col overflow-hidden'>
              <div className='w-full overflow-x-auto'>
                <div>
                  <div className='border-border border-b'>
                    <div className='grid min-w-[980px] grid-cols-[140px_90px_90px_90px_180px_1fr_100px] gap-2 px-2 pb-3 md:gap-3 lg:min-w-0 lg:gap-4'>
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
                        Workflow
                      </div>
                      <div className='font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                        Output
                      </div>
                      <div className='text-right font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                        Duration
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className='flex-1 overflow-auto' style={{ maxHeight: '400px' }}>
                <div className='pb-4'>
                  {(() => {
                    const logsToDisplay = details.logs

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
                      const logDate = log?.startedAt ? new Date(log.startedAt) : null
                      const formattedDate =
                        logDate && !Number.isNaN(logDate.getTime())
                          ? formatDate(logDate.toISOString())
                          : ({ compactDate: '—', compactTime: '' } as any)
                      const outputsStr = log.outputs ? JSON.stringify(log.outputs) : '—'
                      const errorStr = log.errorMessage || ''
                      const isExpanded = expandedRowId === log.id

                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'cursor-pointer border-border border-b transition-all duration-200',
                            isExpanded ? 'bg-accent/30' : 'hover:bg-accent/20'
                          )}
                          onClick={() =>
                            setExpandedRowId((prev) => (prev === log.id ? null : log.id))
                          }
                        >
                          <div className='grid min-w-[980px] grid-cols-[140px_90px_90px_90px_180px_1fr_100px] items-center gap-2 px-2 py-3 md:gap-3 lg:min-w-0 lg:gap-4'>
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
                                      : { backgroundColor: getTriggerColor(log.trigger) }
                                  }
                                >
                                  {log.trigger}
                                </div>
                              ) : (
                                <div className='text-muted-foreground text-xs'>—</div>
                              )}
                            </div>

                            <div>
                              <div className='font-medium text-muted-foreground text-xs'>
                                {log.cost && log.cost.total > 0 ? formatCost(log.cost.total) : '—'}
                              </div>
                            </div>

                            {/* Workflow cell */}
                            <div className='whitespace-nowrap'>
                              {log.workflowName ? (
                                <div className='inline-flex items-center gap-2'>
                                  <span
                                    className='h-3.5 w-3.5 rounded'
                                    style={{ backgroundColor: log.workflowColor || '#64748b' }}
                                  />
                                  <span
                                    className='max-w-[150px] truncate text-muted-foreground text-xs'
                                    title={log.workflowName}
                                  >
                                    {log.workflowName}
                                  </span>
                                </div>
                              ) : (
                                <span className='text-muted-foreground text-xs'>—</span>
                              )}
                            </div>

                            {/* Output cell */}
                            <div className='min-w-0 truncate whitespace-nowrap pr-2 text-[13px] text-muted-foreground'>
                              {log.level === 'error' && errorStr ? (
                                <span className='font-medium text-red-500 dark:text-red-400'>
                                  {errorStr}
                                </span>
                              ) : outputsStr.length > 220 ? (
                                `${outputsStr.slice(0, 217)}…`
                              ) : (
                                outputsStr
                              )}
                            </div>

                            <div className='text-right'>
                              <div className='text-muted-foreground text-xs tabular-nums'>
                                {typeof log.duration === 'number' ? `${log.duration}ms` : '—'}
                              </div>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className='px-2 pt-0 pb-4'>
                              <div className='rounded-md border bg-muted/30 p-2'>
                                <pre className='max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs'>
                                  {log.level === 'error' && errorStr ? errorStr : outputsStr}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className='flex items-center justify-center py-12'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkflowDetails
