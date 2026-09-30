'use client'

import { useId } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader, Skeleton } from '@sim/emcn'
import {
  CHANGE_LIST_WIDTH_CLASS,
  WorkflowDiffView,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff'
import { useForkWorkflowDiff } from '@/ee/workspace-forking/hooks/use-fork-workflow-diff'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const EMPTY_STATE: WorkflowState = { blocks: {}, edges: [], loops: {}, parallels: {} }

interface ForkWorkflowDiffModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  otherWorkspaceId: string
  direction: ForkDirection
  sourceWorkflowId: string
  workflowName: string
}

/**
 * What a sync would change inside one workflow: the target as it stands on the
 * left of the arrow, the source's deployment on the right, block ids already
 * lined up through the fork's block map.
 */
export function ForkWorkflowDiffModal({
  open,
  onOpenChange,
  workspaceId,
  otherWorkspaceId,
  direction,
  sourceWorkflowId,
  workflowName,
}: ForkWorkflowDiffModalProps) {
  const descriptionId = useId()
  const query = useForkWorkflowDiff({ workspaceId, otherWorkspaceId, direction, sourceWorkflowId })

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Changes to ${workflowName}`}
      aria-describedby={descriptionId}
      size='full'
      className='h-[92vh] [&>div]:h-full'
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>{workflowName}</ChipModalHeader>
      <ChipModalBody fullBleed>
        <p id={descriptionId} className='sr-only'>
          Blocks, fields and connections this sync would change in the workflow.
        </p>
        {query.error ? (
          <div className='flex h-full items-center justify-center text-[var(--text-error)] text-small'>
            {query.error.message || 'Could not load the comparison.'}
          </div>
        ) : !query.data ? (
          <div className='flex h-full'>
            <Skeleton className='h-full flex-1 rounded-none' />
            <Skeleton
              className={`h-full ${CHANGE_LIST_WIDTH_CLASS} rounded-none border-[var(--border)] border-l`}
            />
          </div>
        ) : (
          <WorkflowDiffView
            baseState={query.data.before ?? EMPTY_STATE}
            targetState={query.data.after}
            baseLabel={query.data.before ? query.data.beforeLabel : 'Not in target yet'}
            targetLabel={query.data.afterLabel}
            environmentBindings
          />
        )}
      </ChipModalBody>
    </ChipModal>
  )
}
