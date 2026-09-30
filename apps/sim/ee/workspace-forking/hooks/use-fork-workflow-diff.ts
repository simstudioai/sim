import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getForkWorkflowDiffContract } from '@/lib/api/contracts/workspace-fork'
import { type ForkDirection, forkKeys } from '@/ee/workspace-forking/hooks/workspace-fork'

/**
 * Nested under the fork diff keys so the promote, rollback and unlink
 * mutations' existing invalidation of `forkKeys.diffs()` covers a preview too.
 */
export const forkWorkflowDiffKeys = {
  all: [...forkKeys.diffs(), 'workflow'] as const,
  details: () => [...forkWorkflowDiffKeys.all, 'detail'] as const,
  detail: (
    workspaceId?: string,
    otherWorkspaceId?: string,
    direction?: ForkDirection,
    sourceWorkflowId?: string
  ) =>
    [
      ...forkWorkflowDiffKeys.details(),
      workspaceId ?? '',
      otherWorkspaceId ?? '',
      direction ?? '',
      sourceWorkflowId ?? '',
    ] as const,
}

export const FORK_WORKFLOW_DIFF_STALE_TIME = 30 * 1000

interface UseForkWorkflowDiffParams {
  workspaceId: string
  otherWorkspaceId: string
  direction: ForkDirection
  sourceWorkflowId: string
}

/** The block-level before and after of one workflow in a sync. */
export function useForkWorkflowDiff({
  workspaceId,
  otherWorkspaceId,
  direction,
  sourceWorkflowId,
}: UseForkWorkflowDiffParams) {
  return useQuery({
    queryKey: forkWorkflowDiffKeys.detail(
      workspaceId,
      otherWorkspaceId,
      direction,
      sourceWorkflowId
    ),
    queryFn: ({ signal }) =>
      requestJson(getForkWorkflowDiffContract, {
        params: { id: workspaceId },
        query: { otherWorkspaceId, direction, sourceWorkflowId },
        signal,
      }),
    staleTime: FORK_WORKFLOW_DIFF_STALE_TIME,
  })
}
