import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  listCredentialProviderCatalog,
  requireAvailableServiceAccountCredentialProvider,
} from '@/lib/credentials/application/provider-catalog'
import {
  type CreateServiceAccountCredentialParams,
  createServiceAccountCredential,
  deleteConnectionCredential,
} from '@/lib/credentials/orchestration'
import { type CredentialRow, getWorkspaceCredential } from '@/lib/credentials/queries'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type CreateServiceAccountInput = Omit<
  CreateServiceAccountCredentialParams,
  'userId' | 'request'
>

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

function principalUserId(principal: Extract<Principal, { kind: 'personal_api_key' }>): string {
  return principal.userId
}

export const createServiceAccountCredentialUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.createServiceAccount,
  resolveContext: async ({ input }: { input: CreateServiceAccountInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  async execute({ principal, input, context, request }): Promise<CreateServiceAccountResult> {
    const catalog = await listCredentialProviderCatalog(principal, context)
    requireAvailableServiceAccountCredentialProvider(catalog, input.providerId)
    const result = await createServiceAccountCredential({
      ...input,
      workspaceId: context.workspaceId,
      userId: principalUserId(principal),
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
    const actor = await getCredentialActorContext(result.credential.id, principalUserId(principal))
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
      principalUserId(principal),
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

interface CredentialApplicationContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
  credential: CredentialRow
}

export interface DeleteCredentialInput {
  workspaceId: string
  credentialId: string
}

export interface DeleteCredentialResult {
  credential: CredentialRow
}

async function resolveCredentialContext(
  input: DeleteCredentialInput
): Promise<CredentialApplicationContext> {
  const workspace = await loadActiveWorkspaceApplicationContext(input.workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Credential not found')
  const credential = await getWorkspaceCredential({
    workspaceId: workspace.workspaceId,
    credentialId: input.credentialId,
  })
  if (!credential || !['oauth', 'service_account'].includes(credential.type)) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }
  return { ...workspace, credential }
}

export const deleteCredentialUseCase = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.delete,
  resolveContext: async ({ input }: { input: DeleteCredentialInput }) =>
    resolveCredentialContext(input),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<DeleteCredentialResult> {
    const userId = principalUserId(principal)
    const actor = await getCredentialActorContext(context.credential.id, userId)
    if (!actor.credential || !actor.hasWorkspaceAccess) {
      throw new OrchestrationError('not_found', 'Credential not found')
    }
    if (!actor.isAdmin) {
      throw new ForbiddenOperationError(
        'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
        'Credential admin permission required'
      )
    }

    await deleteConnectionCredential({
      credentialId: input.credentialId,
      workspaceId: context.workspaceId,
      reason: 'user_delete',
    })
    return { credential: context.credential }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CREDENTIAL_DELETED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: result.credential.id,
    resourceName: result.credential.displayName,
    description: `Deleted ${result.credential.type} credential "${result.credential.displayName}" (user_delete)`,
    metadata: {
      reason: 'user_delete',
      credentialType: result.credential.type,
      providerId: result.credential.providerId,
      accountId: result.credential.accountId,
    },
  }),
  afterSuccess: ({ principal, context, result }) => {
    captureServerEvent(
      principalUserId(principal),
      'credential_deleted',
      {
        credential_type: result.credential.type as 'oauth' | 'service_account',
        provider_id: result.credential.providerId ?? result.credential.id,
        workspace_id: context.workspaceId,
      },
      { groups: { workspace: context.workspaceId } }
    )
  },
})
