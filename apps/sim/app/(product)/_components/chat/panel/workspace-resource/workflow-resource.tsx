'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { isApiClientError } from '@/lib/api/client/errors'
import styles from '@/app/(product)/_components/chat/panel/workspace-resource/workspace-resource.module.css'
import { WorkflowPreview } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-preview/workflow-preview'
import { useWorkflowState } from '@/platform/lib/data/workflow-editor'

interface WorkflowResourceProps {
  workspaceId: string
  workflowId: string
}

/**
 * A workflow as a pannable read-only canvas of its current state, which follows the agent's edits
 * as the chat refreshes it. Editing and running happen on its workflow page.
 */
export function WorkflowResource({ workspaceId, workflowId }: WorkflowResourceProps) {
  const state = useWorkflowState(workflowId)
  if (state.data)
    return (
      <div className={styles.canvas}>
        <WorkflowPreview
          workflowState={state.data}
          workspaceId={workspaceId}
          isPannable
          defaultZoom={0.8}
          cursorStyle='grab'
          height='100%'
          width='100%'
        />
      </div>
    )
  if (isApiClientError(state.error) && state.error.status === 404)
    return (
      <EmptyState
        title='Workflow not found'
        description='This workflow may have been deleted or moved.'
      />
    )
  if (state.isError)
    return (
      <div className={styles.notice}>
        <FailureNotice
          message={getErrorMessage(state.error, 'This workflow could not be loaded.')}
          retrying={state.isFetching}
          onRetry={() => void state.refetch()}
        />
      </div>
    )
  return null
}
