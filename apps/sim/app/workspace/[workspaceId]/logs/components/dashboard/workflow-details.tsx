import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Info, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import LineChart, {
  type LineChartPoint,
} from '@/app/workspace/[workspaceId]/logs/components/dashboard/line-chart'
import { getTriggerColor } from '@/app/workspace/[workspaceId]/logs/components/dashboard/utils'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
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
  hasPendingPause?: boolean
}

export interface WorkflowDetailsData {
  errorRates: LineChartPoint[]
  durations?: LineChartPoint[]
  durationP50?: LineChartPoint[]
  durationP90?: LineChartPoint[]
  durationP99?: LineChartPoint[]
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
  onLoadMore,
  hasMore,
  isLoadingMore,
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
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
}) {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()

  // Check if any logs have pending status to show Resume column
  const hasPendingExecutions = useMemo(() => {
    return details?.logs?.some((log) => log.hasPendingPause === true) || false
  }, [details])

  const workflowColor = useMemo(
    () => workflows[expandedWorkflowId]?.color || '#3972F6',
    [workflows, expandedWorkflowId]
  )
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const loaderRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const rootEl = listRef.current
    const sentinel = loaderRef.current
    if (!rootEl || !sentinel || !onLoadMore || !hasMore) return

    let ticking = false
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && hasMore && !ticking && !isLoadingMore) {
          ticking = true
          setTimeout(() => {
            onLoadMore()
            ticking = false
          }, 50)
        }
      },
      { root: rootEl, threshold: 0.1, rootMargin: '200px 0px 0px 0px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore, hasMore, isLoadingMore])

  // Fallback: if IntersectionObserver fails (older browsers), use scroll position
  useEffect(() => {
    const el = listRef.current
    if (!el || !onLoadMore || !hasMore) return

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const pct = (scrollTop / Math.max(1, scrollHeight - clientHeight)) * 100
      if (pct > 80 && !isLoadingMore) onLoadMore()
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [onLoadMore, hasMore, isLoadingMore])

  return (
    <div className='mt-1 overflow-hidden rounded-[11px] border bg-card shadow-sm'>
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
              <span className='font-[480] text-sm tracking-tight group-hover:text-primary dark:font-[560]'>
                {workflowName}
              </span>
            </button>
          </div>
          <div className='flex items-center gap-2'>
            <div className='inline-flex h-7 items-center gap-2 border px-2.5'>
              <span className='text-[11px] text-muted-foreground'>Executions</span>
              <span className='font-[500] text-sm leading-none'>{overview.total}</span>
            </div>
            <div className='inline-flex h-7 items-center gap-2 border px-2.5'>
              <span className='text-[11px] text-muted-foreground'>Success</span>
              <span className='font-[500] text-sm leading-none'>{overview.rate.toFixed(1)}%</span>
            </div>
            <div className='inline-flex h-7 items-center gap-2 border px-2.5'>
              <span className='text-[11px] text-muted-foreground'>Failures</span>
              <span className='font-[500] text-sm leading-none'>{overview.failures}</span>
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
                  <div className='mb-4 flex items-center justify-between border bg-muted/30 px-3 py-2 text-[13px] text-foreground'>
                    <div className='flex items-center gap-2'>
                      <div className='h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-primary/30' />
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
                      className='rounded px-2 py-1 text-foreground text-xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40'
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
                <div className={`mb-3 grid grid-cols-1 gap-3 ${gridCols}`}>
                  <LineChart
                    data={details.errorRates}
                    label='Error Rate'
                    color='#ef4444'
                    unit='%'
                  />
                  {hasDuration && (
                    <LineChart
                      data={details.durations!}
                      label='Duration'
                      color='#3b82f6'
                      unit='ms'
                      series={
                        [
                          details.durationP50
                            ? {
                                id: 'p50',
                                label: 'p50',
                                color: '#60A5FA',
                                data: details.durationP50,
                                dashed: true,
                              }
                            : undefined,
                          details.durationP90
                            ? {
                                id: 'p90',
                                label: 'p90',
                                color: '#3B82F6',
                                data: details.durationP90,
                              }
                            : undefined,
                          details.durationP99
                            ? {
                                id: 'p99',
                                label: 'p99',
                                color: '#1D4ED8',
                                data: details.durationP99,
                              }
                            : undefined,
                        ].filter(Boolean) as any
                      }
                    />
                  )}
                  <LineChart
                    data={details.executionCounts}
                    label='Executions'
                    color='#10b981'
                    unit='execs'
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
                  <div className='border-b-0'>
                    <div
                      className={cn(
                        'grid min-w-[980px] gap-2 px-2 pb-3 md:gap-3 lg:min-w-0 lg:gap-4',
                        hasPendingExecutions
                          ? 'grid-cols-[140px_90px_90px_90px_180px_1fr_100px_40px]'
                          : 'grid-cols-[140px_90px_90px_90px_180px_1fr_100px]'
                      )}
                    >
                      <div className='font-[460] font-sans text-[13px] text-muted-foreground leading-normal'>
                        Time
                      </div>
                      <div className='font-[460] font-sans text-[13px] text-muted-foreground leading-normal'>
                        Status
                      </div>
                      <div className='font-[460] font-sans text-[13px] text-muted-foreground leading-normal'>
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
                      {hasPendingExecutions && (
                        <div className='text-right font-[480] font-sans text-[13px] text-muted-foreground leading-normal'>
                          Resume
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div ref={listRef} className='flex-1 overflow-auto' style={{ maxHeight: '400px' }}>
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
                      const baseLevel = (log.level || 'info').toLowerCase()
                      const isPending = log.hasPendingPause === true
                      const isError = baseLevel === 'error'
                      const statusLabel = isPending
                        ? 'Pending'
                        : `${baseLevel.charAt(0).toUpperCase()}${baseLevel.slice(1)}`

                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'cursor-pointer transition-all duration-200',
                            isExpanded ? 'bg-accent/30' : 'hover:bg-accent/20'
                          )}
                          onClick={() =>
                            setExpandedRowId((prev) => (prev === log.id ? null : log.id))
                          }
                        >
                          <div
                            className={cn(
                              'grid min-w-[980px] items-center gap-2 px-2 py-3 md:gap-3 lg:min-w-0 lg:gap-4',
                              hasPendingExecutions
                                ? 'grid-cols-[140px_90px_90px_90px_180px_1fr_100px_40px]'
                                : 'grid-cols-[140px_90px_90px_90px_180px_1fr_100px]'
                            )}
                          >
                            <div>
                              <div className='text-[13px]'>
                                <span className='font-sm text-muted-foreground'>
                                  {formattedDate.compactDate}
                                </span>
                                <span
                                  style={{ marginLeft: '8px' }}
                                  className='hidden font-[400] sm:inline'
                                >
                                  {formattedDate.compactTime}
                                </span>
                              </div>
                            </div>

                            <div>
                              {isError || !isPending ? (
                                <div
                                  className={cn(
                                    'flex h-[24px] w-[56px] items-center justify-start rounded-[6px] border pl-[9px]',
                                    isError
                                      ? 'gap-[5px] border-[#883827] bg-[#491515]'
                                      : 'gap-[8px] border-[#686868] bg-[#383838]'
                                  )}
                                >
                                  <div
                                    className='h-[6px] w-[6px] rounded-[2px]'
                                    style={{
                                      backgroundColor: isError ? '#EF4444' : '#B7B7B7',
                                    }}
                                  />
                                  <span
                                    className='font-medium text-[11.5px]'
                                    style={{ color: isError ? '#EF4444' : '#B7B7B7' }}
                                  >
                                    {statusLabel}
                                  </span>
                                </div>
                              ) : (
                                <div className='inline-flex items-center bg-amber-300 px-[6px] py-[2px] font-[400] text-amber-900 text-xs dark:bg-amber-500/90 dark:text-black'>
                                  {statusLabel}
                                </div>
                              )}
                            </div>

                            <div>
                              {log.trigger ? (
                                <div
                                  className='inline-flex items-center rounded-[6px] px-[6px] py-[2px] font-[400] text-white text-xs lg:px-[8px]'
                                  style={{ backgroundColor: getTriggerColor(log.trigger) }}
                                >
                                  {log.trigger}
                                </div>
                              ) : (
                                <div className='text-muted-foreground text-xs'>—</div>
                              )}
                            </div>

                            <div>
                              <div className='font-[400] text-muted-foreground text-xs'>
                                {log.cost && log.cost.total > 0 ? formatCost(log.cost.total) : '—'}
                              </div>
                            </div>

                            {/* Workflow cell */}
                            <div className='whitespace-nowrap'>
                              {log.workflowName ? (
                                <div className='inline-flex items-center gap-2'>
                                  <span
                                    className='h-3.5 w-3.5'
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

                            {hasPendingExecutions && (
                              <div className='flex justify-end'>
                                {isPending && log.executionId ? (
                                  <Link
                                    href={`/resume/${expandedWorkflowId}/${log.executionId}`}
                                    className='inline-flex h-7 w-7 items-center justify-center border border-primary/60 border-dashed text-primary hover:bg-primary/10'
                                    aria-label='Open resume console'
                                  >
                                    <ArrowUpRight className='h-4 w-4' />
                                  </Link>
                                ) : (
                                  <span className='h-7 w-7' />
                                )}
                              </div>
                            )}
                          </div>
                          {isExpanded && (
                            <div className='px-2 pt-0 pb-4'>
                              <div className='border bg-muted/30 p-2'>
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
                  {/* Bottom loading / sentinel */}
                  {hasMore && details.logs.length > 0 && (
                    <div className='flex items-center justify-center py-3 text-muted-foreground'>
                      <div ref={loaderRef} className='flex items-center gap-2'>
                        {isLoadingMore ? (
                          <>
                            <Loader2 className='h-4 w-4 animate-spin' />
                            <span className='text-sm'>Loading more…</span>
                          </>
                        ) : (
                          <span className='text-sm'>Scroll to load more</span>
                        )}
                      </div>
                    </div>
                  )}
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
