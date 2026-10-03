import { AuditAction, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { credentialUserOperations } from '@/lib/credentials/application/operations'
import {
  disconnectOAuthAccounts,
  listConnectedAccountsForUser,
  listOAuthConnectionsForUser,
  OAuthDisconnectPartialFailureError,
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

function projectDeletedCredentialAudit(
  credentials: OAuthDisconnectPartialFailureError['credentials']
) {
  return credentials.map((credential) => ({
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
  }))
}

function captureDeletedCredentialEvents(
  userId: string,
  credentials: OAuthDisconnectPartialFailureError['credentials'],
  provider: string,
  providerId?: string
): void {
  for (const credential of credentials) {
    if (!credential.workspaceId) continue
    captureServerEvent(
      userId,
      'credential_deleted',
      {
        credential_type: 'oauth',
        provider_id: credential.providerId ?? providerId ?? provider,
        workspace_id: credential.workspaceId,
      },
      { groups: credential.workspaceId ? { workspace: credential.workspaceId } : {} }
    )
  }
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
    ...projectDeletedCredentialAudit(result.credentials),
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
  projectErrorAudit: ({ error }) =>
    error instanceof OAuthDisconnectPartialFailureError
      ? projectDeletedCredentialAudit(error.credentials)
      : undefined,
  afterSuccess: ({ principal, result }) => {
    captureDeletedCredentialEvents(
      principal.userId,
      result.credentials,
      result.provider,
      result.providerId
    )
  },
  afterError: ({ principal, input, error }) => {
    if (!(error instanceof OAuthDisconnectPartialFailureError)) return
    captureDeletedCredentialEvents(
      principal.userId,
      error.credentials,
      input.provider,
      input.providerId
    )
  },
})
