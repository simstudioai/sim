import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, organizationBYOKKeys, workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { MAX_BYOK_KEYS_PER_PROVIDER } from '@/lib/api/contracts/byok-keys'
import {
  byokKeyOperations,
  type OrganizationByokOperation,
  type OrganizationByokPrincipal,
} from '@/lib/api-key/application/operations'
import { isOrganizationBYOKEntitled } from '@/lib/api-key/byok-entitlement'
import {
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
  type OperationUseCase,
} from '@/lib/core/application'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { captureServerEvent } from '@/lib/posthog/server'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('OrganizationBYOKKeys')

/** Bounds waits on the per-organization/provider transaction lock. */
const ORGANIZATION_BYOK_LOCK_TIMEOUT_MS = 5_000

interface OrganizationByokAuthorizationContext {
  organizationId: string
  actorUserId: string
}

interface AuthorizedOrganizationByokExecuteArgs<I extends { organizationId: string }> {
  principal: OrganizationByokPrincipal
  input: I
  context: OrganizationByokAuthorizationContext
  request?: OrchestrationRequestContext
}

interface AuthorizedOrganizationByokDefinition<
  O extends OrganizationByokOperation,
  I extends { organizationId: string },
  R,
> {
  operation: O
  execute(args: AuthorizedOrganizationByokExecuteArgs<I>): Promise<R>
}

function requireOrganizationByokPrincipal(
  principal: Principal,
  operation: OrganizationByokOperation
): asserts principal is OrganizationByokPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

function defineAuthorizedOrganizationByokUseCase<
  const O extends OrganizationByokOperation,
  I extends { organizationId: string },
  R,
>(definition: AuthorizedOrganizationByokDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      requireOrganizationByokPrincipal(principal, definition.operation)

      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.organizationId, input.organizationId), eq(member.userId, principal.userId))
        )
        .limit(1)

      if (!membership) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_MEMBERSHIP_REQUIRED',
          'Not a member of the requested organization'
        )
      }
      if (!definition.operation.organizationRoles.some((role) => role === membership.role)) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_ADMIN_REQUIRED',
          'Organization admin or owner role required'
        )
      }
      if (
        definition.operation.entitlement === 'required' &&
        !(await isOrganizationBYOKEntitled(input.organizationId))
      ) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_PLAN_REQUIRED',
          'An active organization plan is required for organization BYOK'
        )
      }

      return definition.execute({
        principal,
        input,
        context: { organizationId: input.organizationId, actorUserId: principal.userId },
        request,
      })
    },
  }
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '•'.repeat(8)
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
}

function providerIdFromStorage(providerId: string): BYOKProviderId {
  return providerId as BYOKProviderId
}

type OrganizationByokKeyRow = Pick<
  typeof organizationBYOKKeys.$inferSelect,
  'id' | 'providerId' | 'encryptedApiKey' | 'name' | 'createdBy' | 'createdAt' | 'updatedAt'
>

export interface OrganizationByokKeyProjection {
  id: string
  providerId: BYOKProviderId
  name: string | null
  maskedKey: string
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface OrganizationByokKeyMutationProjection {
  id: string
  providerId: BYOKProviderId
  name: string | null
  maskedKey: string
  createdAt?: Date
  updatedAt?: Date
}

async function projectOrganizationByokKey(
  organizationId: string,
  key: OrganizationByokKeyRow
): Promise<OrganizationByokKeyProjection> {
  let maskedKey = '••••••••'
  try {
    const { decrypted } = await decryptSecret(key.encryptedApiKey)
    maskedKey = maskApiKey(decrypted)
  } catch (error) {
    logger.error('Failed to decrypt organization BYOK key for display', {
      error,
      organizationId,
      providerId: key.providerId,
      keyId: key.id,
    })
  }

  return {
    id: key.id,
    providerId: providerIdFromStorage(key.providerId),
    name: key.name,
    maskedKey,
    createdBy: key.createdBy,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  }
}

function recordOrganizationByokAudit(params: {
  organizationId: string
  actorUserId: string
  operationId: string
  action:
    | typeof AuditAction.BYOK_KEY_CREATED
    | typeof AuditAction.BYOK_KEY_UPDATED
    | typeof AuditAction.BYOK_KEY_DELETED
  providerId: BYOKProviderId
  keyId?: string
  deletedKeyIds?: string[]
  request?: OrchestrationRequestContext
}): void {
  const verb =
    params.action === AuditAction.BYOK_KEY_CREATED
      ? 'Added'
      : params.action === AuditAction.BYOK_KEY_UPDATED
        ? 'Updated'
        : 'Removed'
  recordAudit({
    workspaceId: null,
    actorId: params.actorUserId,
    action: params.action,
    resourceType: AuditResourceType.BYOK_KEY,
    resourceId: params.keyId,
    resourceName: params.providerId,
    description: `${verb} organization BYOK key for ${params.providerId}`,
    metadata: {
      organizationId: params.organizationId,
      scope: 'organization',
      providerId: params.providerId,
      ...(params.keyId ? { keyId: params.keyId } : {}),
      ...(params.deletedKeyIds ? { deletedKeyIds: params.deletedKeyIds } : {}),
      operation: params.operationId,
    },
    request: params.request,
  })
}

export interface ListOrganizationByokKeysInput {
  organizationId: string
}

export const listOrganizationByokKeys = defineAuthorizedOrganizationByokUseCase({
  operation: byokKeyOperations.listOrganization,
  async execute({ context }: AuthorizedOrganizationByokExecuteArgs<ListOrganizationByokKeysInput>) {
    const [rows, entitled] = await Promise.all([
      db
        .select({
          id: organizationBYOKKeys.id,
          providerId: organizationBYOKKeys.providerId,
          encryptedApiKey: organizationBYOKKeys.encryptedApiKey,
          name: organizationBYOKKeys.name,
          createdBy: organizationBYOKKeys.createdBy,
          createdAt: organizationBYOKKeys.createdAt,
          updatedAt: organizationBYOKKeys.updatedAt,
        })
        .from(organizationBYOKKeys)
        .where(eq(organizationBYOKKeys.organizationId, context.organizationId))
        .orderBy(
          asc(organizationBYOKKeys.providerId),
          asc(organizationBYOKKeys.createdAt),
          asc(organizationBYOKKeys.id)
        ),
      isOrganizationBYOKEntitled(context.organizationId),
    ])

    return {
      keys: await Promise.all(
        rows.map((row) => projectOrganizationByokKey(context.organizationId, row))
      ),
      entitled,
    }
  },
})

export interface SaveOrganizationByokKeyInput {
  organizationId: string
  providerId: BYOKProviderId
  apiKey: string
  keyId?: string
  name?: string
}

export const saveOrganizationByokKey = defineAuthorizedOrganizationByokUseCase({
  operation: byokKeyOperations.saveOrganization,
  async execute({
    input,
    context,
    request,
  }: AuthorizedOrganizationByokExecuteArgs<SaveOrganizationByokKeyInput>) {
    if (input.keyId) {
      const [existingKey] = await db
        .select({ id: organizationBYOKKeys.id, name: organizationBYOKKeys.name })
        .from(organizationBYOKKeys)
        .where(
          and(
            eq(organizationBYOKKeys.organizationId, context.organizationId),
            eq(organizationBYOKKeys.providerId, input.providerId),
            eq(organizationBYOKKeys.id, input.keyId)
          )
        )
        .limit(1)

      if (!existingKey) throw new OrchestrationError('not_found', 'BYOK key not found')

      const { encrypted } = await encryptSecret(input.apiKey)
      const updatedAt = new Date()
      const updatedName = input.name === undefined ? existingKey.name : input.name || null
      const [updatedKey] = await db
        .update(organizationBYOKKeys)
        .set({ encryptedApiKey: encrypted, name: updatedName, updatedAt })
        .where(
          and(
            eq(organizationBYOKKeys.organizationId, context.organizationId),
            eq(organizationBYOKKeys.providerId, input.providerId),
            eq(organizationBYOKKeys.id, existingKey.id)
          )
        )
        .returning({ id: organizationBYOKKeys.id })

      if (!updatedKey) throw new OrchestrationError('not_found', 'BYOK key not found')

      recordOrganizationByokAudit({
        organizationId: context.organizationId,
        actorUserId: context.actorUserId,
        operationId: byokKeyOperations.saveOrganization.id,
        action: AuditAction.BYOK_KEY_UPDATED,
        providerId: input.providerId,
        keyId: updatedKey.id,
        request,
      })

      return {
        key: {
          id: updatedKey.id,
          providerId: input.providerId,
          name: updatedName,
          maskedKey: maskApiKey(input.apiKey),
          updatedAt,
        } satisfies OrganizationByokKeyMutationProjection,
      }
    }

    const newKey = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('lock_timeout', ${`${ORGANIZATION_BYOK_LOCK_TIMEOUT_MS}ms`}, true)`
      )
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`byok:organization:${context.organizationId}:${input.providerId}`}, 0))`
      )

      const [{ keyCount }] = await tx
        .select({ keyCount: count() })
        .from(organizationBYOKKeys)
        .where(
          and(
            eq(organizationBYOKKeys.organizationId, context.organizationId),
            eq(organizationBYOKKeys.providerId, input.providerId)
          )
        )

      if (keyCount >= MAX_BYOK_KEYS_PER_PROVIDER) {
        throw new OrchestrationError(
          'validation',
          `An organization can store at most ${MAX_BYOK_KEYS_PER_PROVIDER} keys per provider`
        )
      }

      const { encrypted } = await encryptSecret(input.apiKey)
      const now = new Date()
      const [inserted] = await tx
        .insert(organizationBYOKKeys)
        .values({
          id: generateShortId(),
          organizationId: context.organizationId,
          providerId: input.providerId,
          encryptedApiKey: encrypted,
          name: input.name || null,
          createdBy: context.actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: organizationBYOKKeys.id,
          providerId: organizationBYOKKeys.providerId,
          name: organizationBYOKKeys.name,
          createdAt: organizationBYOKKeys.createdAt,
          updatedAt: organizationBYOKKeys.updatedAt,
        })

      if (!inserted) throw new Error('Organization BYOK key insert returned no row')
      return inserted
    })

    recordOrganizationByokAudit({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      operationId: byokKeyOperations.saveOrganization.id,
      action: AuditAction.BYOK_KEY_CREATED,
      providerId: input.providerId,
      keyId: newKey.id,
      request,
    })
    captureServerEvent(
      context.actorUserId,
      'organization_byok_key_added',
      { organization_id: context.organizationId, provider_id: input.providerId },
      {
        groups: { organization: context.organizationId },
        setOnce: { first_organization_byok_key_added_at: new Date().toISOString() },
      }
    )

    return {
      key: {
        id: newKey.id,
        providerId: providerIdFromStorage(newKey.providerId),
        name: newKey.name,
        maskedKey: maskApiKey(input.apiKey),
        createdAt: newKey.createdAt,
        updatedAt: newKey.updatedAt,
      } satisfies OrganizationByokKeyMutationProjection,
    }
  },
})

export interface DeleteOrganizationByokKeyInput {
  organizationId: string
  providerId: BYOKProviderId
  keyId?: string
}

export const deleteOrganizationByokKey = defineAuthorizedOrganizationByokUseCase({
  operation: byokKeyOperations.deleteOrganization,
  async execute({
    input,
    context,
    request,
  }: AuthorizedOrganizationByokExecuteArgs<DeleteOrganizationByokKeyInput>) {
    const providerScope = and(
      eq(organizationBYOKKeys.organizationId, context.organizationId),
      eq(organizationBYOKKeys.providerId, input.providerId)
    )
    const deletedKeys = await db
      .delete(organizationBYOKKeys)
      .where(
        input.keyId ? and(providerScope, eq(organizationBYOKKeys.id, input.keyId)) : providerScope
      )
      .returning({ id: organizationBYOKKeys.id })

    if (input.keyId && deletedKeys.length === 0) {
      throw new OrchestrationError('not_found', 'BYOK key not found')
    }

    recordOrganizationByokAudit({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      operationId: byokKeyOperations.deleteOrganization.id,
      action: AuditAction.BYOK_KEY_DELETED,
      providerId: input.providerId,
      keyId: input.keyId,
      deletedKeyIds: deletedKeys.map((key) => key.id),
      request,
    })
    captureServerEvent(
      context.actorUserId,
      'organization_byok_key_removed',
      { organization_id: context.organizationId, provider_id: input.providerId },
      { groups: { organization: context.organizationId } }
    )

    return { success: true as const }
  },
})

export interface ReadInheritedByokStatusInput {
  workspaceId: string
}

export const readInheritedByokStatus = defineAuthorizedWorkspaceUseCase({
  operation: byokKeyOperations.readInheritedStatus,
  resolveContext: async ({ input }: { input: ReadInheritedByokStatusInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  async execute({ context }) {
    const organizationId = context.workspaceOrganizationId
    if (!organizationId || !(await isOrganizationBYOKEntitled(organizationId))) {
      return { inheritedProviderIds: [] as BYOKProviderId[] }
    }

    const [workspaceProviders, organizationProviders] = await Promise.all([
      db
        .selectDistinct({ providerId: workspaceBYOKKeys.providerId })
        .from(workspaceBYOKKeys)
        .where(eq(workspaceBYOKKeys.workspaceId, context.workspaceId)),
      db
        .selectDistinct({ providerId: organizationBYOKKeys.providerId })
        .from(organizationBYOKKeys)
        .where(eq(organizationBYOKKeys.organizationId, organizationId))
        .orderBy(asc(organizationBYOKKeys.providerId)),
    ])
    const overriddenProviderIds = new Set(workspaceProviders.map((row) => row.providerId))

    return {
      inheritedProviderIds: organizationProviders
        .map((row) => providerIdFromStorage(row.providerId))
        .filter((providerId) => !overriddenProviderIds.has(providerId)),
    }
  },
})
