import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type BackgroundWorkItem,
  getWorkspaceBackgroundWorkContract,
} from '@/lib/api/contracts/workspace-fork'

export const backgroundWorkKeys = {
  all: ['backgroundWork'] as const,
  lists: () => [...backgroundWorkKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...backgroundWorkKeys.lists(), workspaceId ?? ''] as const,
}

async function fetchWorkspaceBackgroundWork(
  workspaceId: string,
  signal?: AbortSignal
): Promise<BackgroundWorkItem[]> {
  const data = await requestJson(getWorkspaceBackgroundWorkContract, {
    params: { id: workspaceId },
    signal,
  })
  return data.items
}

const isActive = (item: BackgroundWorkItem) =>
  item.status === 'pending' || item.status === 'processing'

/**
 * Durable "background work in progress" status for a workspace (fork content copy +
 * any deployment side-effects). Poll-first per the best-practice for long jobs: the
 * status survives a reload (it's a DB row), and we only keep polling while something is
 * still running, then stop. Refetch on focus catches changes after the tab was away.
 */
export function useWorkspaceBackgroundWork(workspaceId?: string) {
  return useQuery({
    queryKey: backgroundWorkKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceBackgroundWork(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 5_000,
    refetchInterval: (query) => ((query.state.data ?? []).some(isActive) ? 5_000 : false),
    refetchOnWindowFocus: true,
  })
}
