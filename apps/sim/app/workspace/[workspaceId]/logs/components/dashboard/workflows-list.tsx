import { memo, useMemo } from 'react'
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
  selectedSegments,
  onSegmentClick,
  searchQuery,
  segmentDurationMs,
}: {
  executions: WorkflowExecutionItem[]
  filteredExecutions: WorkflowExecutionItem[]
  expandedWorkflowId: string | null
  onToggleWorkflow: (workflowId: string) => void
  selectedSegments: Record<string, number[]>
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

  // Date axis above the status bars intentionally removed for a cleaner, denser layout

  function DynamicLegend() {
    return (
      <p className='mt-0.5 text-[11px] text-muted-foreground'>
        Each cell ≈ {durationLabel} of the selected range. Click a cell to filter details.
      </p>
    )
  }
  return (
    <div
      className='overflow-hidden border bg-card shadow-sm'
      style={{ height: '380px', display: 'flex', flexDirection: 'column' }}
    >
      <div className='flex-shrink-0 border-b bg-muted/30 px-4 py-2'>
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='font-[480] text-sm'>Workflows</h3>
            <DynamicLegend />
          </div>
          <span className='text-muted-foreground text-xs'>
            {filteredExecutions.length} workflow
            {filteredExecutions.length !== 1 ? 's' : ''}
            {searchQuery && ` (filtered from ${executions.length})`}
          </span>
        </div>
      </div>
      {/* Axis removed */}
      <ScrollArea className='min-h-0 flex-1 overflow-auto'>
        <div className='space-y-1 p-3'>
          {filteredExecutions.length === 0 ? (
            <div className='py-8 text-center text-muted-foreground text-sm'>
              No workflows found matching "{searchQuery}"
            </div>
          ) : (
            filteredExecutions.map((workflow, idx) => {
              const isSelected = expandedWorkflowId === workflow.workflowId

              return (
                <div
                  key={workflow.workflowId}
                  className={`flex cursor-pointer items-center gap-4 px-2 py-1.5 transition-colors ${
                    isSelected ? 'bg-accent/40' : 'hover:bg-accent/20'
                  }`}
                  onClick={() => onToggleWorkflow(workflow.workflowId)}
                >
                  <div className='w-52 min-w-0 flex-shrink-0'>
                    <div className='flex items-center gap-2'>
                      <div
                        className='h-[14px] w-[14px] flex-shrink-0'
                        style={{
                          backgroundColor: workflows[workflow.workflowId]?.color || '#64748b',
                        }}
                      />
                      <h3 className='truncate font-[460] text-sm dark:font-medium'>
                        {workflow.workflowName}
                      </h3>
                    </div>
                  </div>

                  <div className='flex-1'>
                    <StatusBar
                      segments={workflow.segments}
                      selectedSegmentIndices={selectedSegments[workflow.workflowId] || null}
                      onSegmentClick={onSegmentClick as any}
                      workflowId={workflow.workflowId}
                      segmentDurationMs={segmentDurationMs}
                      preferBelow={idx < 2}
                    />
                  </div>

                  <div className='w-16 flex-shrink-0 text-right'>
                    <span className='font-[460] text-muted-foreground text-sm'>
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

export default memo(WorkflowsList)
