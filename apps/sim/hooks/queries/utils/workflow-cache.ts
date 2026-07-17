import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const EMPTY_WORKFLOWS: WorkflowMetadata[] = []

/**
 * Reads workflow metadata for a workspace directly from the React Query cache.
 */
export function getWorkflows(
  workspaceId: string,
  scope: WorkflowQueryScope = 'active'
): WorkflowMetadata[] {
  return (
    getQueryClient().getQueryData<WorkflowMetadata[]>(workflowKeys.list(workspaceId, scope)) ??
    EMPTY_WORKFLOWS
  )
}

/**
 * Reads a single workflow by id from the React Query cache.
 */
export function getWorkflowById(
  workspaceId: string,
  workflowId: string,
  scope: WorkflowQueryScope = 'active'
): WorkflowMetadata | undefined {
  return getWorkflows(workspaceId, scope).find((workflow) => workflow.id === workflowId)
}
