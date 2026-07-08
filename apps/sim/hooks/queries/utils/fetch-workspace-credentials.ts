import { requestJson } from '@/lib/api/client/request'
import { listWorkspaceCredentialsContract, type WorkspaceCredential } from '@/lib/api/contracts'

/**
 * Fetches the workspace credential list.
 *
 * Lives in this standalone (non-`'use client'`) module so block definitions and
 * server prefetch can import it without pulling client-reference stubs from the
 * `'use client'` `@/hooks/queries/credentials` module.
 */
export async function fetchWorkspaceCredentialList(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceCredential[]> {
  const data = await requestJson(listWorkspaceCredentialsContract, {
    query: { workspaceId },
    signal,
  })
  return data.credentials ?? []
}
