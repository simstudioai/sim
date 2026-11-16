import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowSourceContract, type WorkflowSource } from '@/lib/api/contracts/workflow-source'

/** The Code tab invalidates after every persisted edit, so staleness only covers idle refocus. */
const WORKFLOW_SOURCE_STALE_TIME = 30_000

export const workflowSourceKeys = {
  all: ['workflow-source'] as const,
  details: () => [...workflowSourceKeys.all, 'detail'] as const,
  detail: (workflowId?: string) => [...workflowSourceKeys.details(), workflowId ?? ''] as const,
}

async function fetchWorkflowSource(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowSource> {
  const { data } = await requestJson(getWorkflowSourceContract, {
    params: { id: workflowId },
    query: { functionCode: 'inline' },
    signal,
  })
  return data
}

/** The workflow's draft printed as one TypeScript file (function code inline), for display. */
export function useWorkflowSource(workflowId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowSourceKeys.detail(workflowId),
    queryFn: ({ signal }) => fetchWorkflowSource(workflowId as string, signal),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: WORKFLOW_SOURCE_STALE_TIME,
  })
}
