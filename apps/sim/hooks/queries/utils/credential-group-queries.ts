import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceAccountsSettings } from '@/lib/api/contracts/credential-groups'
import { getWorkspaceAccountsContract } from '@/lib/api/contracts/credential-groups'

export const WORKSPACE_ACCOUNTS_STALE_TIME = 30 * 1000

export const credentialGroupKeys = {
  all: ['workspace-accounts'] as const,
  workspaces: () => [...credentialGroupKeys.all, 'workspace'] as const,
  workspace: (workspaceId?: string) =>
    [...credentialGroupKeys.workspaces(), workspaceId ?? ''] as const,
  details: () => [...credentialGroupKeys.all, 'detail'] as const,
  detail: (workspaceId?: string, groupId?: string) =>
    [...credentialGroupKeys.details(), workspaceId ?? '', groupId ?? ''] as const,
}

/** The workspace account configuration and provider availability share one cache entry. */
export async function fetchWorkspaceAccounts(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceAccountsSettings> {
  return requestJson(getWorkspaceAccountsContract, { params: { id: workspaceId }, signal })
}
