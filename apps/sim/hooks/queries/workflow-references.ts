import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkflowReferencesContract,
  type WorkflowReferencesResponse,
} from '@/lib/api/contracts/workflow-references'

/**
 * Zero — the graph reflects live editor state, and no workflow-edit mutation
 * invalidates this key (edits arrive over the socket, not through React Query).
 * The modal mounts on demand, so every open refetches; a reopen paints the
 * cached tree instantly while the background refetch reconciles it.
 */
export const WORKFLOW_REFERENCES_STALE_TIME = 0

export const workflowReferenceKeys = {
  all: ['workflow-references'] as const,
  details: () => [...workflowReferenceKeys.all, 'detail'] as const,
  detail: (workflowId?: string) => [...workflowReferenceKeys.details(), workflowId ?? ''] as const,
}

async function fetchWorkflowReferences(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowReferencesResponse> {
  return requestJson(getWorkflowReferencesContract, {
    params: { id: workflowId },
    signal,
  })
}

export function useWorkflowReferences(workflowId?: string) {
  return useQuery({
    queryKey: workflowReferenceKeys.detail(workflowId),
    queryFn: ({ signal }) => fetchWorkflowReferences(workflowId as string, signal),
    enabled: Boolean(workflowId),
    staleTime: WORKFLOW_REFERENCES_STALE_TIME,
  })
}
