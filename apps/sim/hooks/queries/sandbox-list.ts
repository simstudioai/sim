import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { listSandboxesContract, type SandboxListResponse } from '@/lib/api/contracts/sandboxes'

export const sandboxKeys = {
  all: ['sandboxes'] as const,
  lists: () => [...sandboxKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...sandboxKeys.lists(), workspaceId ?? ''] as const,
}

export const SANDBOX_LIST_STALE_TIME = 30 * 1000

async function fetchSandboxes(
  workspaceId: string,
  signal?: AbortSignal
): Promise<SandboxListResponse> {
  return requestJson(listSandboxesContract, { params: { id: workspaceId }, signal })
}

export function getSandboxListQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: sandboxKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchSandboxes(workspaceId, signal),
    retryOnMount: true,
    staleTime: SANDBOX_LIST_STALE_TIME,
  })
}
