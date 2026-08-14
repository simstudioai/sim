import { AuditAction, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { credentialUserOperations } from '@/lib/credentials/application/operations'
import {
  disconnectOAuthAccounts,
  listConnectedAccountsForUser,
  listOAuthConnectionsForUser,
} from '@/lib/credentials/oauth-accounts'
import { captureServerEvent } from '@/lib/posthog/server'

export const listOAuthConnectionsUseCase = defineAuthorizedCredentialUserUseCase({
  operation: credentialUserOperations.listOAuthConnections,
  async execute({ principal }) {
    return { connections: await listOAuthConnectionsForUser(principal.userId) }
  },
})

export interface ListConnectedAccountsInput {
  provider?: string
}

export const listConnectedAccountsUseCase = defineAuthorizedCredentialUserUseCase({
  operation: credentialUserOperations.listConnectedAccounts,
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ListConnectedAccountsInput
  }) {
    return {
      accounts: await listConnectedAccountsForUser({
        userId: principal.userId,
        provider: input.provider,
      }),
    }
  },
})

export interface DisconnectOAuthInput {
  provider: string
  providerId?: string
  accountId?: string
}

export const disconnectOAuthUseCase = defineAuthorizedCredentialUserUseCase({
  operation: credentialUserOperations.disconnectOAuth,
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: DisconnectOAuthInput
  }) {
    const result = await disconnectOAuthAccounts({ userId: principal.userId, ...input })
    return { ...result, ...input, success: true as const }
  },
  projectAudit: ({ result }) => [
    ...result.credentials.map((credential) => ({
      workspaceId: credential.workspaceId,
      action: AuditAction.CREDENTIAL_DELETED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credential.id,
      resourceName: credential.displayName,
      description: `Deleted oauth credential "${credential.displayName}" (oauth_disconnect)`,
      metadata: {
        reason: 'oauth_disconnect',
        credentialType: credential.type,
        providerId: credential.providerId,
        accountId: credential.accountId,
      },
    })),
    {
      workspaceId: null,
      action: AuditAction.OAUTH_DISCONNECTED,
      resourceType: AuditResourceType.OAUTH,
      resourceId: result.providerId ?? result.provider,
      resourceName: result.provider,
      description: `Disconnected OAuth provider: ${result.provider}`,
      metadata: { provider: result.provider, providerId: result.providerId },
    },
  ],
  afterSuccess: ({ principal, result }) => {
    for (const credential of result.credentials) {
      captureServerEvent(
        principal.userId,
        'credential_deleted',
        {
          credential_type: 'oauth',
          provider_id: credential.providerId ?? result.providerId ?? result.provider,
          workspace_id: credential.workspaceId,
        },
        { groups: { workspace: credential.workspaceId } }
      )
    }
  },
})
