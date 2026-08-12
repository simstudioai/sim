import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import type { ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getWorkspaceEnvKeyAdminAccess } from '@/lib/credentials/environment'
import {
  listVisibleWorkspaceCredentials,
  type VisibleWorkspaceCredential,
} from '@/lib/credentials/queries'
import {
  deletePersonalSecret,
  deleteWorkspaceSecret,
  setPersonalSecret,
  setWorkspaceSecret,
} from '@/lib/credentials/secret-values'
import { secretOperations } from '@/lib/secrets/application/operations'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export type SecretScope = 'workspace' | 'personal'
export type SecretSortBy = 'name' | 'createdAt' | 'updatedAt'

interface SecretWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

async function resolveWorkspaceContext(workspaceId: string): Promise<SecretWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

function principalUserId(
  principal: Extract<Principal, { kind: 'session' | 'personal_api_key' }>
): string {
  return principal.userId
}

function credentialTypes(scope?: SecretScope) {
  if (scope === 'workspace') return ['env_workspace'] as const
  if (scope === 'personal') return ['env_personal'] as const
  return ['env_workspace', 'env_personal'] as const
}

async function listSecretMetadata(params: {
  workspaceId: string
  userId: string
  scope?: SecretScope
  search?: string
  sortBy: SecretSortBy
  sortOrder: ListSortOrder
}): Promise<VisibleWorkspaceCredential[]> {
  const workspaceAccess = await checkWorkspaceAccess(params.workspaceId, params.userId)
  const rows = await listVisibleWorkspaceCredentials({
    workspaceId: params.workspaceId,
    userId: params.userId,
    workspaceAccess,
    types: [...credentialTypes(params.scope)],
    search: params.search,
    sortBy: params.sortBy === 'name' ? 'displayName' : params.sortBy,
    sortOrder: params.sortOrder,
  })
  return rows.filter((row) => row.type === 'env_workspace' || row.envOwnerUserId === params.userId)
}

async function requireWorkspaceSecretMutationAccess(params: {
  workspaceId: string
  name: string
  userId: string
}): Promise<void> {
  const [workspaceAccess, keyAccess] = await Promise.all([
    checkWorkspaceAccess(params.workspaceId, params.userId),
    getWorkspaceEnvKeyAdminAccess({
      workspaceId: params.workspaceId,
      envKeys: [params.name],
      userId: params.userId,
    }),
  ])

  if (keyAccess.knownKeys.has(params.name)) {
    if (!workspaceAccess.canAdmin && !keyAccess.adminKeys.has(params.name)) {
      throw new OrchestrationError(
        'forbidden',
        'Credential admin permission required for this secret'
      )
    }
    return
  }
  if (!workspaceAccess.canWrite) {
    throw new OrchestrationError('forbidden', 'Write permission required to set this secret')
  }
}

async function getSecretMetadata(params: {
  workspaceId: string
  userId: string
  scope: SecretScope
  name: string
}): Promise<VisibleWorkspaceCredential> {
  const rows = await listSecretMetadata({
    ...params,
    search: params.name,
    sortBy: 'name',
    sortOrder: 'asc',
  })
  const row = rows.find(
    (candidate) =>
      candidate.envKey === params.name &&
      (params.scope === 'workspace'
        ? candidate.type === 'env_workspace'
        : candidate.type === 'env_personal' && candidate.envOwnerUserId === params.userId)
  )
  if (!row) throw new Error(`Secret metadata was not created for ${params.scope}:${params.name}`)
  return row
}

const authorizationOptions = {}

export interface ListSecretsInput {
  workspaceId: string
  scope?: SecretScope
  search?: string
  sortBy: SecretSortBy
  sortOrder: ListSortOrder
}

export const listSecretsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.list,
  resolveContext: ({ input }: { input: ListSecretsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    const secrets = await listSecretMetadata({
      ...input,
      workspaceId: context.workspaceId,
      userId,
    })
    return { secrets, userId }
  },
})

export interface SetSecretInput {
  workspaceId: string
  name: string
  scope: SecretScope
  value: string
}

export const setSecretUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.set,
  resolveContext: ({ input }: { input: SetSecretInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    if (input.scope === 'workspace') {
      await requireWorkspaceSecretMutationAccess({
        workspaceId: context.workspaceId,
        name: input.name,
        userId,
      })
    }

    const mutation =
      input.scope === 'workspace'
        ? await setWorkspaceSecret({
            workspaceId: context.workspaceId,
            name: input.name,
            value: input.value,
            userId,
          })
        : await setPersonalSecret({ userId, name: input.name, value: input.value })
    const secret = await getSecretMetadata({
      workspaceId: context.workspaceId,
      userId,
      scope: input.scope,
      name: input.name,
    })
    return { secret, userId, created: mutation.created }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ENVIRONMENT_UPDATED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: `${input.scope}:${input.name}`,
    resourceName: input.name,
    description: `Set ${input.scope} secret "${input.name}"`,
    metadata: { scope: input.scope, name: input.name },
  }),
})

export interface DeleteSecretInput {
  workspaceId: string
  name: string
  scope: SecretScope
}

export const deleteSecretUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.delete,
  resolveContext: ({ input }: { input: DeleteSecretInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    if (input.scope === 'workspace') {
      await requireWorkspaceSecretMutationAccess({
        workspaceId: context.workspaceId,
        name: input.name,
        userId,
      })
    }

    const deleted =
      input.scope === 'workspace'
        ? await deleteWorkspaceSecret({ workspaceId: context.workspaceId, name: input.name })
        : await deletePersonalSecret({ userId, name: input.name })
    if (!deleted) throw new OrchestrationError('not_found', 'Secret not found')
    return { name: input.name, scope: input.scope }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ENVIRONMENT_DELETED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: `${input.scope}:${input.name}`,
    resourceName: input.name,
    description: `Deleted ${input.scope} secret "${input.name}"`,
    metadata: { scope: input.scope, name: input.name },
  }),
})
