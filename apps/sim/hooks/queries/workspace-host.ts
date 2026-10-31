import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkspaceHostContextContract,
  type WorkspaceHostContext,
} from '@/lib/api/contracts/workspaces'

export const workspaceHostKeys = {
  all: ['workspace-host'] as const,
  details: () => [...workspaceHostKeys.all, 'detail'] as const,
  detail: (workspaceId: string) => [...workspaceHostKeys.details(), workspaceId] as const,
}

export const WORKSPACE_HOST_CONTEXT_STALE_TIME = 30 * 1000

async function fetchWorkspaceHostContext(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceHostContext> {
  return requestJson(getWorkspaceHostContextContract, {
    params: { id: workspaceId },
    signal,
  })
}

interface WorkspaceHostContextQueryOptions {
  refetchInterval?: number | false
  refetchOnWindowFocus?: boolean
}

/**
 * Loads identity, host organization, owner-plan entitlements, and the viewer's
 * route-scoped authorization for one workspace.
 */
export function useWorkspaceHostContextQuery(
  workspaceId: string,
  options: WorkspaceHostContextQueryOptions = {}
) {
  return useQuery({
    ...options,
    queryKey: workspaceHostKeys.detail(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceHostContext(workspaceId, signal),
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_HOST_CONTEXT_STALE_TIME,
  })
}
