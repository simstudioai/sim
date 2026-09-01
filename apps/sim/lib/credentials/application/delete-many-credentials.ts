import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { deleteCredentialRecord } from '@/lib/credentials/orchestration'
import type { CredentialRow } from '@/lib/credentials/queries'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('DeleteManyCredentialsApplication')
const MAX_CREDENTIAL_DELETE_BATCH = 20

export interface DeleteManyCredentialsInput {
  workspaceId: string
  credentialIds: string[]
}

export interface DeleteManyCredentialsResult {
  deleted: string[]
  failed: string[]
  deletedCredentials: CredentialRow[]
}

export const deleteManyCredentialsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.deleteMany,
  resolveContext: async ({ input }: { input: DeleteManyCredentialsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  async execute({ principal, input, context }): Promise<DeleteManyCredentialsResult> {
    if (input.credentialIds.length === 0) {
      throw new OrchestrationError('validation', 'At least one credential ID is required')
    }
    if (input.credentialIds.length > MAX_CREDENTIAL_DELETE_BATCH) {
      throw new OrchestrationError(
        'validation',
        `At most ${MAX_CREDENTIAL_DELETE_BATCH} credentials can be deleted at once`
      )
    }
    if (new Set(input.credentialIds).size !== input.credentialIds.length) {
      throw new OrchestrationError('validation', 'Credential IDs must be unique')
    }

    const userId = requirePrincipalSubjectUserId(principal)
    const deleted: string[] = []
    const failed: string[] = []
    const deletedCredentials: CredentialRow[] = []

    for (const credentialId of input.credentialIds) {
      try {
        const access = await getCredentialActorContext(credentialId, userId)
        if (
          !access.credential ||
          access.credential.workspaceId !== context.workspaceId ||
          !access.hasWorkspaceAccess ||
          !access.isAdmin ||
          access.credential.type !== 'oauth'
        ) {
          failed.push(credentialId)
          continue
        }
        const didDelete = await deleteCredentialRecord({
          credential: access.credential,
          reason: 'copilot_delete',
        })
        if (!didDelete) {
          failed.push(credentialId)
          continue
        }
        deleted.push(credentialId)
        deletedCredentials.push(access.credential)
      } catch (error) {
        logger.error('Failed to delete credential in Copilot batch', { credentialId, error })
        failed.push(credentialId)
      }
    }

    return { deleted, failed, deletedCredentials }
  },
  projectAudit: ({ result }) =>
    result.deletedCredentials.map((credential) => ({
      action: AuditAction.CREDENTIAL_DELETED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credential.id,
      resourceName: credential.displayName,
      description: `Deleted oauth credential "${credential.displayName}" (copilot_delete)`,
      metadata: {
        reason: 'copilot_delete',
        credentialType: credential.type,
        providerId: credential.providerId,
        accountId: credential.accountId,
      },
    })),
  afterSuccess: ({ principal, context, result }) => {
    for (const credential of result.deletedCredentials) {
      captureServerEvent(
        requirePrincipalSubjectUserId(principal),
        'credential_deleted',
        {
          credential_type: 'oauth',
          provider_id: credential.providerId ?? credential.id,
          workspace_id: context.workspaceId,
        },
        { groups: { workspace: context.workspaceId } }
      )
    }
  },
})
