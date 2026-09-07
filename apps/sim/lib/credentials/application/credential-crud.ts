import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  canUseCredential,
  getCredentialActorContext,
  requireOrdinaryCredentialType,
} from '@/lib/credentials/access'
import {
  defineAuthorizedCredentialUseCase,
  requireCredentialAccess,
  requireManageableCredentialType,
} from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import {
  createCredentialRecord,
  isProviderOutageCode,
  type PerformCreateCredentialParams,
  type PerformCredentialResult,
  type PerformUpdateCredentialParams,
  updateCredentialRecord,
} from '@/lib/credentials/orchestration'
import {
  createPersonalTokenCredential,
  updatePersonalTokenCredential,
} from '@/lib/credentials/personal-tokens'
import {
  type CredentialRow,
  findWorkspaceCredentialLookup,
  listVisibleWorkspaceCredentials,
  type VisibleWorkspaceCredential,
  type WorkspaceCredentialLookup,
} from '@/lib/credentials/queries'
import { getServiceAccountGatingBlockType } from '@/lib/credentials/service-account-provider-ids'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import { allowedIntegrationTypes } from '@/lib/integrations/principal-scope.server'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export class CredentialProviderOperationError extends OrchestrationError {
  constructor(
    message: string,
    readonly providerErrorCode: string,
    readonly providerUnavailable: boolean
  ) {
    super('validation', message)
    this.name = 'CredentialProviderOperationError'
  }
}

export function throwCredentialMutationFailure(result: {
  success: boolean
  error?: string
  errorCode?: PerformCredentialResult['errorCode']
  providerErrorCode?: string
  providerUnavailable?: boolean
}): never {
  if (result.providerErrorCode) {
    throw new CredentialProviderOperationError(
      result.error ?? result.providerErrorCode,
      result.providerErrorCode,
      result.providerUnavailable === true || isProviderOutageCode(result.providerErrorCode)
    )
  }
  switch (result.errorCode) {
    case 'validation':
    case 'not_found':
    case 'conflict':
      throw new OrchestrationError(result.errorCode, result.error ?? 'Credential mutation failed')
    case 'forbidden':
      throw new OrchestrationError('forbidden', result.error ?? 'Credential mutation forbidden')
    default:
      throw new Error(result.error ?? 'Credential mutation failed')
  }
}

export interface ListInternalCredentialsInput {
  workspaceId: string
  type?: CredentialRow['type']
  providerId?: string
  credentialId?: string
}

export type ListInternalCredentialsResult =
  | { mode: 'list'; credentials: VisibleWorkspaceCredential[] }
  | { mode: 'lookup'; credential: WorkspaceCredentialLookup | null }

async function filterGatedServiceAccountCredentials(
  credentials: VisibleWorkspaceCredential[],
  viewer: { userId: string; organizationId: string | null }
): Promise<VisibleWorkspaceCredential[]> {
  const gatedProviderIds = new Set(
    credentials.flatMap(({ providerId }) => {
      if (!providerId || !getServiceAccountGatingBlockType(providerId)) return []
      return [providerId]
    })
  )
  if (gatedProviderIds.size === 0) return credentials

  const blockVisibility = await getBlockVisibility({
    userId: viewer.userId,
    ...(viewer.organizationId ? { orgId: viewer.organizationId } : {}),
  })
  const visibility = createIntegrationCredentialVisibility({
    allowedIntegrationTypes: null,
    blockVisibility,
  })

  return credentials.filter((credential) => {
    const { providerId } = credential
    if (!providerId || !gatedProviderIds.has(providerId)) return true
    if (credential.type !== 'service_account') {
      throw new Error(
        `Gated service-account provider ${providerId} has credential type ${credential.type}`
      )
    }
    return visibility.isCredentialVisible({ providerId, type: credential.type })
  })
}

export const listInternalCredentials = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.listInternal,
  resolveContext: async ({ input }: { input: ListInternalCredentialsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ListInternalCredentialsResult> {
    if (input.credentialId) {
      return {
        mode: 'lookup',
        credential: await findWorkspaceCredentialLookup({
          workspaceId: context.workspaceId,
          credentialId: input.credentialId,
          userId: requirePrincipalSubjectUserId(principal),
        }),
      }
    }

    const userId = requirePrincipalSubjectUserId(principal)
    if (!input.type || input.type === 'oauth') {
      await syncWorkspaceOAuthCredentialsForUser({ workspaceId: context.workspaceId, userId })
    }
    const workspaceAccess = await checkWorkspaceAccess(context.workspaceId, userId)
    const page = await listVisibleWorkspaceCredentials({
      workspaceId: context.workspaceId,
      userId,
      workspaceAccess,
      types: input.type ? [input.type] : undefined,
      providerId: input.providerId,
    })
    const credentials = await filterGatedServiceAccountCredentials(page.data, {
      userId,
      organizationId: context.workspaceOrganizationId,
    })
    return { mode: 'list', credentials }
  },
})

export type CreateWorkspaceCredentialInput = Omit<
  PerformCreateCredentialParams,
  'userId' | 'actorName' | 'actorEmail' | 'request'
>

export interface CreateWorkspaceCredentialResult {
  credential: CredentialRow
  created: boolean
  role: 'admin' | 'member'
  status: 'active' | 'pending' | 'revoked'
  auditMetadata: Record<string, unknown>
}

/**
 * The credential types that belong to one person rather than to the workspace:
 * a personal environment secret, and an OAuth grant bound to the connecting
 * user's own linked account. `env_workspace`, `service_account` and
 * `managed_oauth` are workspace-shared and stay available.
 */
const PERSONAL_SCOPE_CREDENTIAL_TYPES: ReadonlySet<PerformCreateCredentialParams['type']> = new Set(
  ['env_personal', 'oauth', 'personal_token']
)

export const createWorkspaceCredential = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.create,
  resolveContext: async ({ input }: { input: CreateWorkspaceCredentialInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<CreateWorkspaceCredentialResult> {
    const userId = requirePrincipalSubjectUserId(principal)
    /**
     * permission-group-enforced: credentials.personal — scope is the request's
     * `type`, not a property of the operation: the same `credentials.create`
     * makes a personal secret and a workspace-shared one. Declaring the
     * capability on the operation would refuse both, so it is asserted here
     * against the type actually being created.
     */
    if (PERSONAL_SCOPE_CREDENTIAL_TYPES.has(input.type)) {
      await assertWorkspaceCapability(
        userId,
        context.workspaceId,
        'credentials.personal',
        context.workspaceOrganizationId
      )
    }
    if (input.type === 'personal_token') {
      const [allowedIntegrations, blockVisibility] = await Promise.all([
        allowedIntegrationTypes(principal, context.workspaceId),
        getBlockVisibility({
          userId,
          ...(context.workspaceOrganizationId ? { orgId: context.workspaceOrganizationId } : {}),
        }),
      ])
      if (
        !createIntegrationCredentialVisibility({
          allowedIntegrationTypes: allowedIntegrations,
          blockVisibility,
        }).isCredentialVisible({ providerId: input.providerId ?? '', type: 'personal_token' })
      )
        throw new OrchestrationError('forbidden', 'GitLab is unavailable in this workspace')
    }
    const result =
      input.type === 'personal_token'
        ? await createPersonalTokenCredential({ ...input, userId })
        : await createCredentialRecord({ ...input, userId }, { authorizeWorkspace: false })
    if (!result.success) throwCredentialMutationFailure(result)
    if (!result.credential) throw new Error('Credential creation succeeded without a credential')
    const access = await getCredentialActorContext(result.credential.id, userId)
    if (!access.credential || !canUseCredential(access)) {
      throw new Error('Created credential is not visible to its creator')
    }
    const role = access.isAdmin ? 'admin' : access.member?.role
    const status = access.member?.status ?? (access.isAdmin ? 'active' : undefined)
    if (!role || !status) throw new Error('Created credential has no active actor membership')
    return {
      credential: access.credential,
      created: result.created === true,
      role,
      status,
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
          description: `Created ${result.credential.type} credential "${result.credential.displayName}"`,
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
        credential_type: requireOrdinaryCredentialType(result.credential.type),
        provider_id: result.credential.providerId ?? result.credential.type,
        workspace_id: context.workspaceId,
      },
      {
        groups: { workspace: context.workspaceId },
        setOnce: { first_credential_connected_at: new Date().toISOString() },
      }
    )
  },
})

export interface GetWorkspaceCredentialInput {
  credentialId: string
}

export const getWorkspaceCredentialUseCase = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.read,
  resolveContext: ({ input }: { input: GetWorkspaceCredentialInput }) =>
    resolveCredentialApplicationContext(input),
  async execute({ context }) {
    return { credential: context.credential, access: requireCredentialAccess(context) }
  },
})

export type UpdateWorkspaceCredentialInput = Omit<
  PerformUpdateCredentialParams,
  'userId' | 'actorName' | 'actorEmail' | 'allowedTypes' | 'reason' | 'request'
> & {
  /**
   * Workspace the caller asserts owns the credential; a mismatch is concealed as
   * a not-found. The internal surface omits it and resolves the credential's own
   * workspace instead, which is what it did before this field existed.
   */
  assertedWorkspaceId?: string
}

export const updateWorkspaceCredentialUseCase = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspaceCredentialInput }) =>
    resolveCredentialApplicationContext(input),
  async execute({ principal, input, context }) {
    requireManageableCredentialType(principal, context.credential)
    const { assertedWorkspaceId, ...fields } = input
    if (context.credential.type === 'personal_token') {
      const allowedFields = new Set([
        'credentialId',
        'displayName',
        'description',
        'apiToken',
        'domain',
      ])
      if (
        Object.entries(fields).some(
          ([key, value]) => value !== undefined && !allowedFields.has(key)
        )
      )
        throw new OrchestrationError(
          'validation',
          'Personal tokens allow only token, name, and description updates'
        )
    }
    const result =
      context.credential.type === 'personal_token'
        ? await updatePersonalTokenCredential({ ...fields, credential: context.credential })
        : await updateCredentialRecord({ ...fields, credential: context.credential })
    if (!result.success) throwCredentialMutationFailure(result)
    const access = await getCredentialActorContext(
      context.credential.id,
      requirePrincipalSubjectUserId(principal)
    )
    if (!access.credential || !access.isAdmin) {
      throw new Error('Updated credential is no longer visible to its administrator')
    }
    return {
      credential: access.credential,
      access,
      previousDisplayName: context.credential.displayName,
      updatedFields: result.updatedFields ?? [],
      auditMetadata: result.auditMetadata ?? {},
    }
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.CREDENTIAL_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credential.id,
    resourceName: context.credential.displayName,
    description: `Updated ${context.credential.type} credential "${context.credential.displayName}"`,
    metadata: {
      ...result.auditMetadata,
      credentialType: context.credential.type,
      updatedFields: result.updatedFields,
    },
  }),
})
