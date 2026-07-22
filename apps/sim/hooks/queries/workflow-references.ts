import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkflowReferencesContract,
  type WorkflowReferencesResponse,
} from '@/lib/api/contracts/workflow-references'

/**
 * Short — the graph reflects live editor state (workflow blocks/names can change
 * between opens). The modal mounts on demand, so each open refetches once the
 * window lapses while still absorbing rapid open/close flapping.
 */
export const WORKFLOW_REFERENCES_STALE_TIME = 30 * 1000

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
