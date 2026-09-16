import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { apiKey, user } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { getApiKeyDisplayFormat } from '@/lib/api-key/auth'
import { assertOperationCapability, type OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'
import { captureServerEvent } from '@/lib/posthog/server'
import type { UserAccountOperation } from '@/lib/users/application/operations'
import { authorizeAccountPreferences } from '@/lib/users/application/preferences-authorization'

function definePersonalKeyOperation<const Id extends string>(
  id: Id,
  capability: 'api_keys.manage' | 'none'
) {
  const operation = {
    id,
    capability,
    principalKinds: Object.freeze(['session', 'delegated', 'organization_delegated'] as const),
    delegationAudience: 'sim:settings',
  } satisfies UserAccountOperation
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

export const personalApiKeyOperations = {
  list: definePersonalKeyOperation('api_keys.personal.list', 'api_keys.manage'),
  /** permission-group-exempt: a person must retain the ability to revoke their own credentials. */
  revoke: definePersonalKeyOperation('api_keys.personal.revoke', 'none'),
} as const

async function authorizePersonalKeys(principal: Principal, operation: UserAccountOperation) {
  const userId = await authorizeAccountPreferences(principal, operation)
  if (
    operation.capability === 'api_keys.manage' &&
    (await isCapabilityWithheldForUser(userId, 'api_keys.manage'))
  ) {
    throw new OrchestrationError('forbidden', capabilityRefusal('api_keys.manage'))
  }
  return userId
}

interface PersonalApiKeyMetadata {
  id: string
  name: string
  createdAt: Date
  lastUsed: Date | null
  expiresAt: Date | null
  displayKey: string
}

/** Lists metadata for the actual account subject, without exposing persisted key material. */
export const listPersonalApiKeys: OperationUseCase<
  typeof personalApiKeyOperations.list,
  Record<string, never>,
  { keys: PersonalApiKeyMetadata[] }
> = {
  operation: personalApiKeyOperations.list,
  async execute({ principal }) {
    const userId = await authorizePersonalKeys(principal, personalApiKeyOperations.list)
    const keys = await db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        createdAt: apiKey.createdAt,
        lastUsed: apiKey.lastUsed,
        expiresAt: apiKey.expiresAt,
      })
      .from(apiKey)
      .where(and(eq(apiKey.userId, userId), eq(apiKey.type, 'personal')))
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
}

/** Revokes only the account subject's personal key; workspace and foreign keys are concealed. */
export const revokePersonalApiKey: OperationUseCase<
  typeof personalApiKeyOperations.revoke,
  { keyId: string },
  { success: true }
> = {
  operation: personalApiKeyOperations.revoke,
  async execute({ principal, input, request }) {
    const userId = await authorizePersonalKeys(principal, personalApiKeyOperations.revoke)
    const [actor] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const [deleted] = await db
      .delete(apiKey)
      .where(
        and(eq(apiKey.id, input.keyId), eq(apiKey.userId, userId), eq(apiKey.type, 'personal'))
      )
      .returning({ id: apiKey.id, name: apiKey.name })
    if (!deleted) throw new OrchestrationError('not_found', 'API key not found')
    recordAudit({
      workspaceId: null,
      actorId: userId,
      actorName: actor?.name,
      actorEmail: actor?.email,
      action: AuditAction.PERSONAL_API_KEY_REVOKED,
      resourceType: AuditResourceType.API_KEY,
      resourceId: deleted.id,
      resourceName: deleted.name,
      description: `Revoked personal API key: ${deleted.name}`,
      metadata: {
        operation: personalApiKeyOperations.revoke.id,
        actor: resolvePrincipalAuditAttribution(principal).actor,
      },
      request,
    })
    captureServerEvent(userId, 'api_key_revoked', { key_name: deleted.name, scope: 'personal' })
    return { success: true }
  },
}
