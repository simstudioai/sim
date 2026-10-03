import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { and, eq, not } from 'drizzle-orm'
import { getApiKeyDisplayFormat } from '@/lib/api-key/auth'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export class WorkspaceApiKeyWorkspaceNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Workspace not found')
  }
}
async function resolveKeyWorkspace(workspaceId: string) {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new WorkspaceApiKeyWorkspaceNotFoundError()
  return context
}

const principalPolicy = {
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
  workspaceApiKey: 'deny',
} as const
export const workspaceApiKeyOperations = {
  list: defineWorkspaceOperation({
    ...principalPolicy,
    id: 'api_keys.workspace.list',
    minimumRole: 'read',
    capability: 'api_keys.manage',
  }),
  rename: defineWorkspaceOperation({
    ...principalPolicy,
    id: 'api_keys.workspace.rename',
    minimumRole: 'admin',
    capability: 'api_keys.manage',
  }),
  /** permission-group-exempt: admins must retain the ability to revoke exposed credentials. */
  revoke: defineWorkspaceOperation({
    ...principalPolicy,
    id: 'api_keys.workspace.revoke',
    minimumRole: 'admin',
    capability: 'none',
  }),
} as const
const authorizationOptions = { delegation: { audience: 'sim:settings', isWithinScope: () => true } }
interface WorkspaceInput {
  workspaceId: string
}
interface KeyInput extends WorkspaceInput {
  keyId: string
}

export const listWorkspaceApiKeys = defineAuthorizedWorkspaceUseCase({
  operation: workspaceApiKeyOperations.list,
  resolveContext: ({ input }: { input: WorkspaceInput }) => resolveKeyWorkspace(input.workspaceId),
  authorizationOptions,
  async execute({ context }) {
    const keys = await db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        createdAt: apiKey.createdAt,
        lastUsed: apiKey.lastUsed,
        expiresAt: apiKey.expiresAt,
        createdBy: apiKey.createdBy,
      })
      .from(apiKey)
      .where(and(eq(apiKey.workspaceId, context.workspaceId), eq(apiKey.type, 'workspace')))
      .orderBy(apiKey.createdAt)
    return {
      keys: await Promise.all(
        keys.map(async ({ key, ...metadata }) => ({
          ...metadata,
          displayKey: await getApiKeyDisplayFormat(key),
        }))
      ),
    }
  },
})

export const renameWorkspaceApiKey = defineAuthorizedWorkspaceUseCase({
  operation: workspaceApiKeyOperations.rename,
  resolveContext: ({ input }: { input: KeyInput & { name: string } }) =>
    resolveKeyWorkspace(input.workspaceId),
  authorizationOptions,
  async execute({ context, input }) {
    const scope = and(eq(apiKey.workspaceId, context.workspaceId), eq(apiKey.type, 'workspace'))
    const [existing] = await db
      .select({ id: apiKey.id, name: apiKey.name })
      .from(apiKey)
      .where(and(scope, eq(apiKey.id, input.keyId)))
      .limit(1)
    if (!existing) throw new OrchestrationError('not_found', 'API key not found')
    const [conflict] = await db
      .select({ id: apiKey.id })
      .from(apiKey)
      .where(and(scope, eq(apiKey.name, input.name), not(eq(apiKey.id, input.keyId))))
      .limit(1)
    if (conflict)
      throw new OrchestrationError(
        'validation',
        'A workspace API key with this name already exists'
      )
    const [key] = await db
      .update(apiKey)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(scope, eq(apiKey.id, input.keyId)))
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      })
    if (!key) throw new OrchestrationError('not_found', 'API key not found')
    return { key, previousName: existing.name }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.API_KEY_UPDATED,
    resourceType: AuditResourceType.API_KEY,
    resourceId: result.key.id,
    resourceName: result.key.name,
    description: `Renamed workspace API key from "${result.previousName}" to "${result.key.name}"`,
    metadata: { keyType: 'workspace', previousName: result.previousName, newName: result.key.name },
  }),
})

export const revokeWorkspaceApiKey = defineAuthorizedWorkspaceUseCase({
  operation: workspaceApiKeyOperations.revoke,
  resolveContext: ({ input }: { input: KeyInput }) => resolveKeyWorkspace(input.workspaceId),
  authorizationOptions,
  async execute({ context, input, principal }) {
    const [key] = await db
      .delete(apiKey)
      .where(
        and(
          eq(apiKey.workspaceId, context.workspaceId),
          eq(apiKey.id, input.keyId),
          eq(apiKey.type, 'workspace')
        )
      )
      .returning({ id: apiKey.id, name: apiKey.name, lastUsed: apiKey.lastUsed })
    if (!key) throw new OrchestrationError('not_found', 'API key not found')
    captureServerEvent(
      requirePrincipalSubjectUserId(principal),
      'api_key_revoked',
      { workspace_id: context.workspaceId, key_name: key.name },
      { groups: { workspace: context.workspaceId } }
    )
    return { success: true as const, key }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.API_KEY_REVOKED,
    resourceType: AuditResourceType.API_KEY,
    resourceId: result.key.id,
    resourceName: result.key.name,
    description: `Revoked workspace API key: ${result.key.name}`,
    metadata: {
      keyType: 'workspace',
      keyName: result.key.name,
      lastUsed: result.key.lastUsed?.toISOString() ?? null,
    },
  }),
})
