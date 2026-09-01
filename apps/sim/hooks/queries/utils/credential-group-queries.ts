import { requestJson } from '@/lib/api/client/request'
import type { CredentialGroupSettingsList } from '@/lib/api/contracts/credential-groups'
import { listCredentialGroupsContract } from '@/lib/api/contracts/credential-groups'

export const CREDENTIAL_GROUP_DETAIL_STALE_TIME = Number.POSITIVE_INFINITY
export const CREDENTIAL_GROUP_LIST_STALE_TIME = 30 * 1000
export const CREDENTIAL_GROUP_ACCESS_STALE_TIME = 30 * 1000
const CREDENTIAL_GROUP_ACCESS_QUERY_VERSION = 4

export const credentialGroupKeys = {
  all: ['credential-groups'] as const,
  lists: () => [...credentialGroupKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...credentialGroupKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...credentialGroupKeys.all, 'detail'] as const,
  detail: (workspaceId?: string, groupId?: string) =>
    [...credentialGroupKeys.details(), workspaceId ?? '', groupId ?? ''] as const,
  access: (workspaceId?: string, groupId?: string) =>
    [
      ...credentialGroupKeys.detail(workspaceId, groupId),
      'access',
      CREDENTIAL_GROUP_ACCESS_QUERY_VERSION,
    ] as const,
}

/**
 * The workspace's credential groups together with the providers this deployment can enroll. One
 * cache entry serves every consumer of the list, so the payload is cached whole and each caller
 * reads the part it needs rather than caching two shapes under one key.
 */
export async function fetchCredentialGroupSettings(
  workspaceId: string,
  signal?: AbortSignal
): Promise<CredentialGroupSettingsList> {
  return requestJson(listCredentialGroupsContract, { params: { id: workspaceId }, signal })
}
