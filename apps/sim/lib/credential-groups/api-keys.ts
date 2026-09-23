import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { encryptSecret } from '@/lib/core/security/encryption'
import { credentialGroupApiKeyValueSchema } from '@/lib/credential-groups/api-key-validation'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import {
  lockCredentialGroupEnrollmentLifecycle,
  type PublicCredentialGroupEnrollmentIdentity,
} from '@/lib/credential-groups/enrollments'
import type { DbOrTx } from '@/lib/db/types'

interface ApiKeyScope {
  organizationId: string
  credentialGroupId: string
}

async function lockApiKeyEnrollment(
  tx: DbOrTx,
  identity: PublicCredentialGroupEnrollmentIdentity,
  optionId: string
) {
  await lockCredentialGroupEnrollmentLifecycle(tx, identity.enrollmentId)
  const [group] = await tx
    .select()
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.id, identity.credentialGroupId),
        resourceScopeCondition(credentialGroup, resourceScopeFromOwner(identity)),
        eq(credentialGroup.status, 'active')
      )
    )
    .limit(1)
    .for('update')
  const option = group?.apiKeyOptions.find((item) => item.id === optionId)
  if (!group || !option)
    throw new OrchestrationError('not_found', 'API key request is no longer available')
  const [enrollment] = await tx
    .select()
    .from(credentialGroupEnrollment)
    .where(
      and(
        eq(credentialGroupEnrollment.id, identity.enrollmentId),
        eq(credentialGroupEnrollment.credentialGroupId, group.id),
        eq(credentialGroupEnrollment.email, identity.email),
        eq(credentialGroupEnrollment.invitationTokenHash, identity.invitationTokenHash)
      )
    )
    .limit(1)
    .for('update')
  if (
    !enrollment ||
    !identity.userId ||
    enrollment.userId !== identity.userId ||
    enrollment.revokedAt ||
    ['revoked', 'delivery_failed'].includes(enrollment.status) ||
    enrollment.invitationExpiresAt.getTime() <= Date.now()
  )
    throw new OrchestrationError('not_found', 'Invitation is invalid or expired')
  return { group, option, enrollment, userId: identity.userId }
}

export async function saveEnrollmentApiKey(
  identity: PublicCredentialGroupEnrollmentIdentity,
  optionId: string,
  value: string
) {
  const parsed = credentialGroupApiKeyValueSchema.safeParse(value)
  if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
  const { encrypted } = await encryptSecret(parsed.data)
  return db.transaction(async (tx) => {
    const { group, option, enrollment, userId } = await lockApiKeyEnrollment(tx, identity, optionId)
    const [previous] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'managed_api_key'),
          eq(credential.credentialGroupEnrollmentId, enrollment.id),
          eq(credential.credentialGroupOptionId, option.id)
        )
      )
      .limit(1)
    const now = new Date()
    const [saved] = await tx
      .insert(credential)
      .values({
        id: generateId(),
        workspaceId: group.workspaceId,
        organizationId: group.organizationId,
        type: 'managed_api_key',
        displayName: option.name,
        encryptedApiKey: encrypted,
        credentialGroupEnrollmentId: enrollment.id,
        credentialGroupOptionId: option.id,
        managedOauthStatus: 'active',
        grantedAt: now,
        createdBy: userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [credential.credentialGroupEnrollmentId, credential.credentialGroupOptionId],
        targetWhere: sql`${credential.type} = 'managed_api_key'`,
        set: {
          displayName: option.name,
          encryptedApiKey: encrypted,
          managedOauthStatus: 'active',
          revokedAt: null,
          grantedAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: credential.id })
    if (!saved) throw new Error('API key save returned no credential')
    if (enrollment.status === 'invited')
      await tx
        .update(credentialGroupEnrollment)
        .set({ status: 'in_progress', updatedAt: now })
        .where(eq(credentialGroupEnrollment.id, enrollment.id))
    return {
      credentialId: saved.id,
      optionId: option.id,
      name: option.name,
      created: !previous,
      enrollmentStatus:
        enrollment.status === 'completed' ? ('completed' as const) : ('in_progress' as const),
    }
  })
}

export async function deleteEnrollmentApiKey(
  identity: PublicCredentialGroupEnrollmentIdentity,
  optionId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const { enrollment, userId } = await lockApiKeyEnrollment(tx, identity, optionId)
    await tx
      .delete(credential)
      .where(
        and(
          eq(credential.type, 'managed_api_key'),
          eq(credential.credentialGroupEnrollmentId, enrollment.id),
          eq(credential.credentialGroupOptionId, optionId),
          eq(credential.createdBy, userId)
        )
      )
  })
}

function liveApiKeyConditions(scope: ApiKeyScope) {
  return [
    eq(credential.organizationId, scope.organizationId),
    eq(credentialGroup.organizationId, scope.organizationId),
    eq(credentialGroup.id, scope.credentialGroupId),
    eq(credentialGroup.status, 'active'),
    eq(credential.type, 'managed_api_key'),
    eq(credential.managedOauthStatus, 'active'),
    isNull(credential.revokedAt),
    eq(credential.createdBy, credentialGroupEnrollment.userId),
    inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
    isNull(credentialGroupEnrollment.revokedAt),
  ]
}

export interface CredentialGroupApiKeyReference {
  credentialId: string
  optionId: string
  name: string
  email: string
}

export async function listCredentialGroupApiKeyReferences(
  scope: ApiKeyScope,
  input: { keyName?: string; email?: string; limit: number; cursor?: string }
) {
  const [group] = await db
    .select({ options: credentialGroup.apiKeyOptions })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.id, scope.credentialGroupId),
        eq(credentialGroup.organizationId, scope.organizationId),
        eq(credentialGroup.status, 'active')
      )
    )
    .limit(1)
  if (!group) throw new OrchestrationError('not_found', 'Credential group is unavailable')
  const options = group.options.filter(
    (option) => !input.keyName || option.name.toLowerCase() === input.keyName.toLowerCase()
  )
  if (input.keyName && options.length === 0)
    throw new OrchestrationError('not_found', 'API key request does not exist in this group')
  if (options.length === 0) return { apiKeys: [], count: 0, hasMore: false, nextCursor: null }
  const rows = await db
    .select({
      credentialId: credential.id,
      optionId: credential.credentialGroupOptionId,
      email: credentialGroupEnrollment.email,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        ...liveApiKeyConditions(scope),
        inArray(
          credential.credentialGroupOptionId,
          options.map((option) => option.id)
        ),
        input.email ? eq(credentialGroupEnrollment.email, input.email) : undefined,
        input.cursor ? gt(credential.id, input.cursor) : undefined
      )
    )
    .orderBy(asc(credential.id))
    .limit(input.limit + 1)
  const apiKeys: CredentialGroupApiKeyReference[] = rows.slice(0, input.limit).map((row) => {
    const option = options.find((option) => option.id === row.optionId)
    if (!option) throw new Error('API key credential has no matching request')
    return { ...row, optionId: option.id, name: option.name }
  })
  const hasMore = rows.length > input.limit
  return {
    apiKeys,
    count: apiKeys.length,
    hasMore,
    nextCursor: hasMore ? apiKeys.at(-1)!.credentialId : null,
  }
}

export async function loadCredentialGroupApiKey(scope: ApiKeyScope, credentialId: string) {
  const [row] = await db
    .select({
      credentialId: credential.id,
      optionId: credential.credentialGroupOptionId,
      email: credentialGroupEnrollment.email,
      encryptedValue: credential.encryptedApiKey,
      options: credentialGroup.apiKeyOptions,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(and(...liveApiKeyConditions(scope), eq(credential.id, credentialId)))
    .limit(1)
  const option = row?.options.find((option) => option.id === row.optionId)
  if (!row || !option)
    throw new OrchestrationError('not_found', 'API key credential is unavailable')
  if (!row.encryptedValue) throw new Error('API key credential has no encrypted value')
  return {
    credentialId: row.credentialId,
    optionId: option.id,
    name: option.name,
    email: row.email,
    encryptedValue: row.encryptedValue,
  }
}
