import type { QueryFunctionContext } from '@tanstack/react-query'
import { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowApiRow {
  id: string
  name: string
  description?: string | null
  color: string
  workspaceId: string
  folderId?: string | null
  sortOrder?: number | null
  createdAt: string
  updatedAt?: string | null
  archivedAt?: string | null
}

export const WORKFLOW_LIST_STALE_TIME = 60 * 1000

export function mapWorkflow(workflow: WorkflowApiRow): WorkflowMetadata {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? undefined,
    color: workflow.color,
    workspaceId: workflow.workspaceId,
    folderId: workflow.folderId ?? undefined,
    sortOrder: workflow.sortOrder ?? 0,
    createdAt: new Date(workflow.createdAt),
    lastModified: new Date(workflow.updatedAt || workflow.createdAt),
    archivedAt: workflow.archivedAt ? new Date(workflow.archivedAt) : null,
  }
}

export async function fetchWorkflows(
  workspaceId: string,
  scope: WorkflowQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkflowMetadata[]> {
  const response = await fetch(`/api/workflows?workspaceId=${workspaceId}&scope=${scope}`, {
    signal,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }

  const { data }: { data: WorkflowApiRow[] } = await response.json()
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
