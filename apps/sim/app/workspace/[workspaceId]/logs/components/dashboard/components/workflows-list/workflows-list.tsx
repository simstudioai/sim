import { memo } from 'react'
import { cn } from '@/lib/core/utils/cn'
import {
  DELETED_WORKFLOW_COLOR,
  DELETED_WORKFLOW_LABEL,
} from '@/app/workspace/[workspaceId]/logs/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { StatusBar, type StatusBarSegment } from '..'

export interface WorkflowExecutionItem {
  workflowId: string
  workflowName: string
  segments: StatusBarSegment[]
  overallSuccessRate: number
}

export function WorkflowsList({
  filteredExecutions,
  expandedWorkflowId,
  onToggleWorkflow,
  selectedSegments,
  onSegmentClick,
  searchQuery,
  segmentDurationMs,
}: {
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

  return (
    <div className='flex h-full flex-col overflow-hidden rounded-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-1)]'>
      {/* Table header */}
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

      {/* Table body - scrollable */}
      <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
        {filteredExecutions.length === 0 ? (
          <div className='flex items-center justify-center py-[32px]'>
            <span className='text-[13px] text-[var(--text-secondary)]'>
              {searchQuery ? `No workflows found matching "${searchQuery}"` : 'No workflows found'}
            </span>
          </div>
        ) : (
          <div>
            {filteredExecutions.map((workflow, idx) => {
              const isSelected = expandedWorkflowId === workflow.workflowId
              const isDeletedWorkflow = workflow.workflowName === DELETED_WORKFLOW_LABEL
              const workflowColor = isDeletedWorkflow
                ? DELETED_WORKFLOW_COLOR
                : workflows[workflow.workflowId]?.color || '#64748b'
              const canToggle = !isDeletedWorkflow

              return (
                <div
                  key={workflow.workflowId}
                  className={cn(
                    'flex h-[44px] items-center gap-[16px] px-[24px] hover:bg-[var(--surface-3)] dark:hover:bg-[var(--surface-4)]',
                    canToggle ? 'cursor-pointer' : 'cursor-default',
                    isSelected && 'bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'
                  )}
                  onClick={() => {
                    if (canToggle) {
                      onToggleWorkflow(workflow.workflowId)
                    }
                  }}
                >
                  {/* Workflow name with color */}
                  <div className='flex w-[160px] flex-shrink-0 items-center gap-[8px] pr-[8px]'>
                    <div
                      className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]'
                      style={{
                        backgroundColor: workflowColor,
                      }}
                    />
                    <span className='min-w-0 truncate font-medium text-[12px] text-[var(--text-primary)]'>
                      {workflow.workflowName}
                    </span>
                  </div>

                  {/* Status bar - takes most of the space */}
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

                  {/* Success rate */}
                  <span className='w-[100px] flex-shrink-0 pl-[16px] font-medium text-[12px] text-[var(--text-primary)]'>
                    {workflow.overallSuccessRate.toFixed(1)}%
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(WorkflowsList)
