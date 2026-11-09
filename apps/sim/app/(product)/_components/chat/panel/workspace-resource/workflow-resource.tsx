'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import styles from '@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource.module.css'
import { WorkflowPreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/workflow-preview'
import { useWorkflowPreviewState } from '@/platform/lib/data/workflow-preview'

interface WorkflowResourceProps {
  workspaceId: string
  workflowId: string
}

/**
 * A workflow as a pannable read-only canvas of its current state, which follows the agent's edits
 * as the chat refreshes it. Editing and running happen on its workflow page.
 */
export function WorkflowResource({ workspaceId, workflowId }: WorkflowResourceProps) {
  const { state, missing, read } = useWorkflowPreviewState(workflowId)
  if (state)
    return (
      <div className={styles.canvas}>
        <WorkflowPreview
          workflowState={state}
          workspaceId={workspaceId}
          isPannable
          defaultZoom={0.8}
          cursorStyle='grab'
          height='100%'
          width='100%'
        />
      </div>
    )
  if (missing)
    return (
      <EmptyState
        title='Workflow not found'
        description='This workflow may have been deleted or moved.'
      />
    )
  if (read.status === 'error')
    return (
      <div className={styles.notice}>
        <FailureNotice message={read.message} retrying={read.retrying} onRetry={read.onRetry} />
      </div>
    )
  return null
}
