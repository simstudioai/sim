import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkflowReferencesContract,
  type WorkflowReferencesResponse,
} from '@/lib/api/contracts/workflow-references'

/**
 * Zero — the graph reflects live editor state (workflow blocks/names can change
 * between opens). The modal stays mounted with the query disabled while closed, so
 * a non-zero window would serve a cached graph on reopen without refetching. Zero
 * marks the data stale immediately, forcing a refetch each time the modal reopens.
 */
export const WORKFLOW_REFERENCES_STALE_TIME = 0

export const workflowReferenceKeys = {
  all: ['workflow-references'] as const,
  details: () => [...workflowReferenceKeys.all, 'detail'] as const,
  detail: (workspaceId?: string, workflowId?: string) =>
    [...workflowReferenceKeys.details(), workspaceId ?? '', workflowId ?? ''] as const,
}

async function fetchWorkflowReferences(
  workspaceId: string,
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowReferencesResponse> {
  return requestJson(getWorkflowReferencesContract, {
    params: { id: workflowId },
    query: { workspaceId },
    signal,
  })
}

export function useWorkflowReferences(
  workspaceId?: string,
  workflowId?: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: workflowReferenceKeys.detail(workspaceId, workflowId),
    queryFn: ({ signal }) =>
      fetchWorkflowReferences(workspaceId as string, workflowId as string, signal),
    enabled: Boolean(workspaceId && workflowId) && (options?.enabled ?? true),
    staleTime: WORKFLOW_REFERENCES_STALE_TIME,
  })
}
