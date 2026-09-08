import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceAccountsSettings } from '@/lib/api/contracts/credential-groups'
import { getWorkspaceAccountsContract } from '@/lib/api/contracts/credential-groups'

export const CREDENTIAL_GROUP_DETAIL_STALE_TIME = Number.POSITIVE_INFINITY
export const WORKSPACE_ACCOUNTS_STALE_TIME = 30 * 1000
export const CREDENTIAL_GROUP_ACCESS_STALE_TIME = 30 * 1000
const CREDENTIAL_GROUP_ACCESS_QUERY_VERSION = 4

export const credentialGroupKeys = {
  all: ['workspace-accounts'] as const,
  workspaces: () => [...credentialGroupKeys.all, 'workspace'] as const,
  workspace: (workspaceId?: string) =>
    [...credentialGroupKeys.workspaces(), workspaceId ?? ''] as const,
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

/** The workspace account configuration and provider availability share one cache entry. */
export async function fetchWorkspaceAccounts(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceAccountsSettings> {
  return requestJson(getWorkspaceAccountsContract, { params: { id: workspaceId }, signal })
}
