import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type BYOKKeysResponse, listByokKeysContract } from '@/lib/api/contracts/byok-keys'

export const byokKeysKeys = {
  all: ['byok-keys'] as const,
  lists: () => [...byokKeysKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...byokKeysKeys.lists(), workspaceId ?? ''] as const,
  organizationLists: () => [...byokKeysKeys.all, 'organization-list'] as const,
  organizationList: (organizationId?: string) =>
    [...byokKeysKeys.organizationLists(), organizationId ?? ''] as const,
  inheritedStatuses: () => [...byokKeysKeys.all, 'inherited-status'] as const,
  inheritedStatus: (workspaceId?: string) =>
    [...byokKeysKeys.inheritedStatuses(), workspaceId ?? ''] as const,
}

export const BYOK_KEY_LIST_STALE_TIME = 60 * 1000

async function fetchBYOKKeys(workspaceId: string, signal?: AbortSignal): Promise<BYOKKeysResponse> {
  const data = await requestJson(listByokKeysContract, {
    params: { id: workspaceId },
    signal,
  })
  return { keys: data.keys ?? [] }
}

export function byokKeysQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: byokKeysKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchBYOKKeys(workspaceId, signal),
    retryOnMount: true,
    staleTime: BYOK_KEY_LIST_STALE_TIME,
  })
}
