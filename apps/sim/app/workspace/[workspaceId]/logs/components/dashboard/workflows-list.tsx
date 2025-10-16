import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import StatusBar, {
  type StatusBarSegment,
} from '@/app/workspace/[workspaceId]/logs/components/dashboard/status-bar'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export interface WorkflowExecutionItem {
  workflowId: string
  workflowName: string
  segments: StatusBarSegment[]
  overallSuccessRate: number
}

export function WorkflowsList({
  executions,
  filteredExecutions,
  expandedWorkflowId,
  onToggleWorkflow,
  selectedSegmentIndex,
  onSegmentClick,
  searchQuery,
  segmentDurationMs,
}: {
  executions: WorkflowExecutionItem[]
  filteredExecutions: WorkflowExecutionItem[]
  expandedWorkflowId: string | null
  onToggleWorkflow: (workflowId: string) => void
  selectedSegmentIndex: number[] | null
  onSegmentClick: (
    workflowId: string,
    segmentIndex: number,
    timestamp: string,
    mode: 'single' | 'toggle' | 'range'
  ) => void
  searchQuery: string
  segmentDurationMs: number
}) {
  const { workflows } = useWorkflowRegistry()
  const segmentsCount = filteredExecutions[0]?.segments?.length || 120
  const durationLabel = useMemo(() => {
    const segMs = Math.max(1, Math.floor(segmentDurationMs || 0))
    const days = Math.round(segMs / (24 * 60 * 60 * 1000))
    if (days >= 1) return `${days} day${days !== 1 ? 's' : ''}`
    const hours = Math.round(segMs / (60 * 60 * 1000))
    if (hours >= 1) return `${hours} hour${hours !== 1 ? 's' : ''}`
    const mins = Math.max(1, Math.round(segMs / (60 * 1000)))
    return `${mins} minute${mins !== 1 ? 's' : ''}`
  }, [segmentDurationMs])

  const Axis = () => {
    if (!filteredExecutions.length || !segmentsCount || !segmentDurationMs) return null
    const firstTs = filteredExecutions[0]?.segments?.[0]?.timestamp
    if (!firstTs) return null
    const start = new Date(firstTs)
    if (Number.isNaN(start.getTime())) return null
    const totalMs = segmentsCount * segmentDurationMs
    const end = new Date(start.getTime() + totalMs)
    const midMs = start.getTime() + totalMs / 2
    // Avoid duplicate labels by shifting mid tick slightly if it rounds identical to start/end
    const mid = new Date(midMs + 60 * 1000)

    const useDates = totalMs >= 24 * 60 * 60 * 1000
    const fmt = (d: Date) => {
      if (useDates) return d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
      return d.toLocaleString('en-US', { hour: 'numeric' })
    }

    return (
      <div className='relative px-3 pt-2 pb-1'>
        <div className='mr-[80px] ml-[224px]'>
          <div className='relative h-4'>
            <div className='-z-10 -translate-y-1/2 absolute inset-x-0 top-1/2 h-px bg-border' />
            <div className='flex justify-between text-[10px] text-muted-foreground'>
              <span>{fmt(start)}</span>
              <span>{fmt(mid)}</span>
              <span className='text-right'>{fmt(end)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function DynamicLegend() {
    return (
      <p className='mt-0.5 text-[11px] text-muted-foreground'>
        Each cell ≈ {durationLabel} of the selected range. Click a cell to filter details.
      </p>
    )
  }
  return (
    <div
      className='overflow-hidden rounded-lg border bg-card shadow-sm'
      style={{ maxHeight: '380px', display: 'flex', flexDirection: 'column' }}
    >
      <div className='flex-shrink-0 border-b bg-muted/30 px-4 py-2.5'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='font-medium text-sm'>Workflows</h3>
            <DynamicLegend />
          </div>
          <span className='text-muted-foreground text-xs'>
            {filteredExecutions.length} workflow
            {filteredExecutions.length !== 1 ? 's' : ''}
            {searchQuery && ` (filtered from ${executions.length})`}
          </span>
        </div>
      </div>
      <Axis />
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
                  onClick={() => onToggleWorkflow(workflow.workflowId)}
                >
                  <div className='w-52 min-w-0 flex-shrink-0'>
                    <div className='flex items-center gap-2'>
                      <div
                        className='h-[14px] w-[14px] flex-shrink-0 rounded'
                        style={{
                          backgroundColor: workflows[workflow.workflowId]?.color || '#64748b',
                        }}
                      />
                      <h3 className='truncate font-medium text-sm'>{workflow.workflowName}</h3>
                    </div>
                  </div>

                  <div className='flex-1'>
                    <StatusBar
                      segments={workflow.segments}
                      selectedSegmentIndices={isSelected ? selectedSegmentIndex : null}
                      onSegmentClick={onSegmentClick as any}
                      workflowId={workflow.workflowId}
                      segmentDurationMs={segmentDurationMs}
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
  )
}

export default WorkflowsList
