import type { QueryFunctionContext } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { listWorkflowsContract, type WorkflowListItem } from '@/lib/api/contracts'
import { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

type WorkflowApiRow = WorkflowListItem

export const WORKFLOW_LIST_STALE_TIME = 60 * 1000

export function mapWorkflow(workflow: WorkflowApiRow): WorkflowMetadata {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? undefined,
    color: workflow.color,
    workspaceId: workflow.workspaceId ?? undefined,
    folderId: workflow.folderId,
    sortOrder: workflow.sortOrder,
    createdAt: new Date(workflow.createdAt),
    lastModified: new Date(workflow.updatedAt),
    archivedAt: workflow.archivedAt ? new Date(workflow.archivedAt) : null,
    locked: workflow.locked,
  }
}

export async function fetchWorkflows(
  workspaceId: string,
  scope: WorkflowQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkflowMetadata[]> {
  const { data } = await requestJson(listWorkflowsContract, {
    query: { workspaceId, scope },
    signal,
  })
  return data.map(mapWorkflow)
}

export function getWorkflowListQueryOptions(
  workspaceId: string,
  scope: WorkflowQueryScope = 'active'
) {
  return {
    queryKey: workflowKeys.list(workspaceId, scope),
    queryFn: ({ signal }: QueryFunctionContext) => fetchWorkflows(workspaceId, scope, signal),
    staleTime: WORKFLOW_LIST_STALE_TIME,
  }
}
