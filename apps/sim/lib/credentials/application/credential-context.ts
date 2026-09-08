import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialAuthorizationContext } from '@/lib/credentials/application/authorized-credential-use-case'
import { getCredentialById, getWorkspaceCredential } from '@/lib/credentials/queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ResolveCredentialApplicationContextInput {
  credentialId: string
  assertedWorkspaceId?: string
}

/** Loads a credential canonically and verifies any asserted workspace scope. */
export async function resolveCredentialApplicationContext(
  input: ResolveCredentialApplicationContextInput
): Promise<CredentialAuthorizationContext> {
  const assertedWorkspace = input.assertedWorkspaceId
    ? await loadActiveWorkspaceApplicationContext(input.assertedWorkspaceId)
    : null
  if (input.assertedWorkspaceId && !assertedWorkspace) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }
  const credential = assertedWorkspace
    ? await getWorkspaceCredential({
        workspaceId: assertedWorkspace.workspaceId,
        credentialId: input.credentialId,
      })
    : await getCredentialById(input.credentialId)
  if (!credential?.workspaceId) throw new OrchestrationError('not_found', 'Credential not found')
  const workspace =
    assertedWorkspace ?? (await loadActiveWorkspaceApplicationContext(credential.workspaceId))
  if (!workspace) throw new OrchestrationError('not_found', 'Credential not found')
  return { ...workspace, credential }
}
