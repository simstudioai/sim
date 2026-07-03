import { memo } from 'react'
import { cn, handleKeyboardActivation } from '@sim/emcn'
import { Workflow } from '@sim/emcn/icons'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components'
import { DELETED_WORKFLOW_LABEL } from '@/app/workspace/[workspaceId]/logs/utils'
import { StatusBar, type StatusBarSegment } from '..'

export interface WorkflowExecutionItem {
  workflowId: string
  workflowName: string
  segments: StatusBarSegment[]
  overallSuccessRate: number
}

interface WorkflowsListProps {
  filteredExecutions: WorkflowExecutionItem[]
  expandedWorkflowId: string | null
  onToggleWorkflow: (workflowId: string) => void
  searchQuery: string
}

function WorkflowsListInner({
  filteredExecutions,
  expandedWorkflowId,
  onToggleWorkflow,
  searchQuery,
}: WorkflowsListProps) {
  return (
    <div className='flex h-full flex-col overflow-hidden rounded-md bg-[var(--surface-2)] dark:bg-[var(--surface-1)]'>
      {/* Table header */}
      <div className='flex-shrink-0 rounded-t-[6px] bg-[var(--surface-3)] px-6 py-2.5 dark:bg-[var(--surface-3)]'>
        <div className='flex items-center gap-4'>
          <span className='w-[160px] flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
            Workflow
          </span>
          <span className='flex-1 font-medium text-[var(--text-tertiary)] text-caption'>Logs</span>
          <span className='w-[100px] flex-shrink-0 pl-4 font-medium text-[var(--text-tertiary)] text-caption'>
            Success Rate
          </span>
        </div>
      </div>

      {/* Table body - scrollable */}
      <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden'>
        {filteredExecutions.length === 0 ? (
          <div className='flex items-center justify-center py-8'>
            <span className='text-[var(--text-secondary)] text-small'>
              {searchQuery ? `No workflows found matching "${searchQuery}"` : 'No workflows found'}
            </span>
          </div>
        ) : (
          <div>
            {filteredExecutions.map((workflow, idx) => {
              const isSelected = expandedWorkflowId === workflow.workflowId
              const isDeletedWorkflow = workflow.workflowName === DELETED_WORKFLOW_LABEL
              const canToggle = !isDeletedWorkflow

              return (
                <div
                  key={workflow.workflowId}
                  role='button'
                  aria-disabled={!canToggle}
                  tabIndex={canToggle ? 0 : undefined}
                  className={cn(
                    'flex h-[44px] items-center gap-4 px-6 hover-hover:bg-[var(--surface-3)] dark:hover-hover:bg-[var(--surface-4)]',
                    canToggle ? 'cursor-pointer' : 'cursor-default',
                    isSelected && 'bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'
                  )}
                  onClick={() => {
                    if (canToggle) {
                      onToggleWorkflow(workflow.workflowId)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!canToggle) return
                    handleKeyboardActivation(event, () => onToggleWorkflow(workflow.workflowId))
                  }}
                >
                  {/* Workflow name with icon */}
                  <div className='flex w-[160px] flex-shrink-0 items-center gap-2 pr-2'>
                    <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                    <FloatingOverflowText
                      label={workflow.workflowName}
                      className='block truncate font-medium text-[var(--text-primary)] text-caption'
                    />
                  </div>

                  {/* Status bar - takes most of the space */}
                  <div className='flex-1'>
                    <StatusBar
                      segments={workflow.segments}
                      workflowId={workflow.workflowId}
                      preferBelow={idx < 2}
                    />
                  </div>

                  {/* Success rate */}
                  <span className='w-[100px] flex-shrink-0 pl-4 font-medium text-[var(--text-primary)] text-caption'>
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

export const WorkflowsList = memo(WorkflowsListInner)
