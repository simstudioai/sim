import { requestJson } from '@/lib/api/client/request'
import {
  type ContractJsonResponse,
  listWorkspaceCredentialsContract,
  type WorkspaceCredential,
  type WorkspaceCredentialType,
} from '@/lib/api/contracts'

export const WORKSPACE_CREDENTIAL_LIST_STALE_TIME = 60 * 1000

export function requireWorkspaceCredentialListResponse(
  data: ContractJsonResponse<typeof listWorkspaceCredentialsContract>
): WorkspaceCredential[] {
  if (!('credentials' in data)) {
    throw new Error('Workspace credential list returned a lookup response')
  }
  return data.credentials
}

/**
 * Fetches the workspace credential list.
 *
 * Lives in this standalone (non-`'use client'`) module so block definitions and
 * server prefetch can import it without pulling client-reference stubs from the
 * `'use client'` `@/hooks/queries/credentials` module.
 */
export async function fetchWorkspaceCredentialList(
  workspaceId: string,
  signal?: AbortSignal,
  type?: WorkspaceCredentialType
): Promise<WorkspaceCredential[]> {
  const data = await requestJson(listWorkspaceCredentialsContract, {
    query: { workspaceId, type },
    signal,
  })
  return requireWorkspaceCredentialListResponse(data)
}
