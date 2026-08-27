import { requestJson } from '@/lib/api/client/request'
import type { CredentialGroup } from '@/lib/api/contracts/credential-groups'
import { listCredentialGroupsContract } from '@/lib/api/contracts/credential-groups'

export const CREDENTIAL_GROUP_DETAIL_STALE_TIME = Number.POSITIVE_INFINITY
export const CREDENTIAL_GROUP_LIST_STALE_TIME = 30 * 1000

export const credentialGroupKeys = {
  all: ['credential-groups'] as const,
  lists: () => [...credentialGroupKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...credentialGroupKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...credentialGroupKeys.all, 'detail'] as const,
  detail: (workspaceId?: string, groupId?: string) =>
    [...credentialGroupKeys.details(), workspaceId ?? '', groupId ?? ''] as const,
}

export async function fetchCredentialGroupList(
  workspaceId: string,
  signal?: AbortSignal
): Promise<CredentialGroup[]> {
  const data = await requestJson(listCredentialGroupsContract, {
    params: { id: workspaceId },
    signal,
  })
  return data.credentialGroups
}
