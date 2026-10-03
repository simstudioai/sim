import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import { getCredentialActorContext, requireOrdinaryCredentialType } from '@/lib/credentials/access'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
import {
  defineAuthorizedCredentialUseCase,
  requireManageableCredentialType,
} from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  listCredentialProviderCatalog,
  requireAvailableServiceAccountCredentialProvider,
} from '@/lib/credentials/application/provider-catalog'
import {
  type CreateServiceAccountCredentialParams,
  createServiceAccountCredential,
  deleteCredentialRecord,
} from '@/lib/credentials/orchestration'
import type { CredentialRow } from '@/lib/credentials/queries'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

type InlineServiceAccountInput = Omit<CreateServiceAccountCredentialParams, 'userId' | 'request'>

export interface StoredSlackBotCredentialInput {
  workspaceId: string
  displayName: string
  description?: string
  storedSlackSecrets: {
    signingSecretEnvVar: string
    botTokenEnvVar: string
  }
}

export type CreateServiceAccountInput = InlineServiceAccountInput | StoredSlackBotCredentialInput

export interface CreateServiceAccountResult {
  credential: CredentialRow
  created: boolean
  hasServiceAccountKey: boolean
  role: 'admin' | 'member'
  auditMetadata: Record<string, unknown>
}

class CredentialProviderUnavailableError extends HttpError {
  readonly statusCode = 503

  constructor() {
    super('Credential provider is temporarily unavailable')
    this.name = 'CredentialProviderUnavailableError'
  }
}

export const createServiceAccountCredentialUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.createServiceAccount,
  resolveContext: async ({ input }: { input: CreateServiceAccountInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  async execute({ principal, input, context, request }): Promise<CreateServiceAccountResult> {
    const stored = 'storedSlackSecrets' in input
    if (principal.kind === 'delegated' && !stored) {
      throw new OrchestrationError('validation', 'Copilot must reference existing Sim secrets')
    }
    const catalog = await listCredentialProviderCatalog(principal, context)
    const providerId = stored ? SLACK_CUSTOM_BOT_PROVIDER_ID : input.providerId
    requireAvailableServiceAccountCredentialProvider(catalog, providerId)
    const userId = requirePrincipalSubjectUserId(principal)
    let credentialInput: InlineServiceAccountInput
    if (stored) {
      const { signingSecretEnvVar, botTokenEnvVar } = input.storedSlackSecrets
      const environment = await getEffectiveDecryptedEnv(userId, context.workspaceId)
      const missing = [signingSecretEnvVar, botTokenEnvVar].filter(
        (name) => !Object.hasOwn(environment, name) || !environment[name]
      )
      if (missing.length) {
        throw new OrchestrationError(
          'validation',
          `Stored secrets unavailable: ${missing.join(', ')}`
        )
      }
      credentialInput = {
        workspaceId: context.workspaceId,
        providerId,
        displayName: input.displayName,
        description: input.description,
        signingSecret: environment[signingSecretEnvVar],
        botToken: environment[botTokenEnvVar],
      }
    } else {
      credentialInput = input
    }
    const result = await createServiceAccountCredential({
      ...credentialInput,
      workspaceId: context.workspaceId,
      userId,
      request,
    })
    if (!result.success) {
      if (result.providerUnavailable) throw new CredentialProviderUnavailableError()
      switch (result.errorCode) {
        case 'validation':
        case 'not_found':
        case 'conflict':
          throw new OrchestrationError(result.errorCode, result.error ?? 'Credential create failed')
        case 'forbidden':
          throw new ForbiddenOperationError(
            'INSUFFICIENT_WORKSPACE_ROLE',
            result.error ?? 'Write permission required'
          )
        default:
          throw new Error('Failed to create service-account credential')
      }
    }
    if (!result.credential) {
      throw new Error('Credential creation succeeded without a credential')
    }
    const actor = await getCredentialActorContext(
      result.credential.id,
      requirePrincipalSubjectUserId(principal)
    )
    if (!actor.credential || (!actor.member && !actor.isAdmin)) {
      throw new Error('Created credential is not visible to its creator')
    }
    return {
      credential: result.credential,
      created: result.created === true,
      hasServiceAccountKey: Boolean(result.credential.encryptedServiceAccountKey),
      role: actor.isAdmin ? 'admin' : 'member',
      auditMetadata: result.auditMetadata ?? {},
    }
  },
  projectAudit: ({ result }) =>
    result.created
      ? {
          action: AuditAction.CREDENTIAL_CREATED,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: result.credential.id,
          resourceName: result.credential.displayName,
          description: `Created service_account credential "${result.credential.displayName}"`,
          metadata: {
            ...result.auditMetadata,
            credentialType: result.credential.type,
            providerId: result.credential.providerId,
          },
        }
      : [],
  afterSuccess: ({ principal, context, result }) => {
    if (!result.created) return
    captureServerEvent(
      requirePrincipalSubjectUserId(principal),
      'credential_connected',
      {
        credential_type: 'service_account',
        provider_id: result.credential.providerId ?? 'service_account',
        workspace_id: context.workspaceId,
      },
      {
        groups: { workspace: context.workspaceId },
        setOnce: { first_credential_connected_at: new Date().toISOString() },
      }
    )
  },
})

export interface DeleteCredentialInput {
  workspaceId?: string
  credentialId: string
}

export interface DeleteCredentialResult {
  credential: CredentialRow
  deleted: boolean
}

export const deleteCredentialUseCase = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.delete,
  resolveContext: ({ input }: { input: DeleteCredentialInput }) =>
    resolveCredentialApplicationContext({
      credentialId: input.credentialId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, context }): Promise<DeleteCredentialResult> {
    requireManageableCredentialType(principal, context.credential)
    const reason = principal.kind === 'delegated' ? 'copilot_delete' : 'user_delete'
    const deleted = await deleteCredentialRecord({ credential: context.credential, reason })
    return { credential: context.credential, deleted }
  },
  projectAudit: ({ principal, result }) => {
    if (!result.deleted) return []
    const reason = principal.kind === 'delegated' ? 'copilot_delete' : 'user_delete'
    const description =
      result.credential.type === 'env_personal'
        ? `Deleted personal env credential "${result.credential.envKey}"`
        : result.credential.type === 'env_workspace'
          ? `Deleted workspace env credential "${result.credential.envKey}"`
          : `Deleted ${result.credential.type} credential "${result.credential.displayName}" (${reason})`
    return {
      action: AuditAction.CREDENTIAL_DELETED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: result.credential.id,
      resourceName: result.credential.displayName,
      description,
      metadata: {
        reason,
        credentialType: result.credential.type,
        providerId: result.credential.providerId,
        accountId: result.credential.accountId,
        envKey: result.credential.envKey,
      },
    }
  },
  afterSuccess: ({ principal, context, result }) => {
    if (!result.deleted) return
    captureServerEvent(
      requirePrincipalSubjectUserId(principal),
      'credential_deleted',
      {
        credential_type: requireOrdinaryCredentialType(result.credential.type),
        provider_id:
          result.credential.providerId ?? result.credential.envKey ?? result.credential.id,
        workspace_id: context.workspaceId,
      },
      { groups: { workspace: context.workspaceId } }
    )
  },
})
