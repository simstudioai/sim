import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type BlockVisibilityResponse,
  getBlockVisibilityContract,
} from '@/lib/api/contracts/block-visibility'

export const BLOCK_VISIBILITY_STALE_TIME = 60 * 1000

export const blockVisibilityKeys = {
  all: ['block-visibility'] as const,
  lists: () => [...blockVisibilityKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...blockVisibilityKeys.lists(), workspaceId ?? ''] as const,
}

async function fetchBlockVisibility(
  workspaceId: string,
  signal?: AbortSignal
): Promise<BlockVisibilityResponse> {
  return requestJson(getBlockVisibilityContract, { query: { workspaceId }, signal })
}

/** The viewer's block-visibility projection for a workspace (revealed/disabled/preview-tagged types). */
export function useBlockVisibility(workspaceId?: string) {
  return useQuery({
    queryKey: blockVisibilityKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchBlockVisibility(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: BLOCK_VISIBILITY_STALE_TIME,
  })
}
