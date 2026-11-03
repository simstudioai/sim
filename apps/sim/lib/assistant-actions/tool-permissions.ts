import { db } from '@sim/db'
import {
  assistantToolPermission,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  user,
} from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type {
  AssistantToolPermissionScope,
  AssistantToolPermissions,
} from '@/lib/assistant-actions/types'
import { sameResourceScopeCondition } from '@/lib/core/resource-scope.server'
import { isManagedCredentialGroupBindingLive } from '@/lib/credential-groups/credentials'
import { acquireAdvisoryXactLock, withLockTimeout } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type { AssistantOperationMetadata } from '@/tools/types'

/** One serialization point for settings changes and admission, including accounts with no saved preference. */
export async function lockAssistantToolPermissions(
  scope: AssistantToolPermissionScope,
  tx: DbTransaction
) {
  await withLockTimeout(tx, 5000, () =>
    acquireAdvisoryXactLock(
      tx,
      'assistant_tool_permissions',
      JSON.stringify([
        'assistant-tool-permissions',
        scope.organizationId,
        scope.userId,
        scope.credentialId,
      ])
    )
  )
}

/** Loads account identity through its verified enrollment, including disconnected grants for settings. */
export async function loadAssistantAccount(
  scope: AssistantToolPermissionScope,
  executor: DbOrTx = db
) {
  const query = executor
    .select({
      credentialId: credential.id,
      displayName: credential.displayName,
      providerId: credential.providerId,
      managedOauthStatus: credential.managedOauthStatus,
      enrollmentStatus: credentialGroupEnrollment.status,
      groupStatus: credentialGroup.status,
      options: credentialGroup.options,
      optionId: credential.credentialGroupOptionId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(user, eq(user.id, credentialGroupEnrollment.userId))
    .where(
      and(
        eq(credential.id, scope.credentialId),
        eq(credential.organizationId, scope.organizationId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.createdBy, scope.userId),
        eq(credentialGroupEnrollment.userId, scope.userId),
        eq(user.emailVerified, true),
        sameResourceScopeCondition(credential, credentialGroup)
      )
    )
  const [row] = await query.limit(1)
  if (!row?.providerId || !row.managedOauthStatus) return null
  return {
    credentialId: row.credentialId,
    displayName: row.displayName,
    providerId: row.providerId,
    status: row.managedOauthStatus,
    active: isManagedCredentialGroupBindingLive({
      ...row,
      managedOauthStatus: row.managedOauthStatus,
      optionStatus: row.options.find((option) => option.id === row.optionId)?.status ?? null,
    }),
  }
}

export async function loadAssistantToolPermissions(
  scope: AssistantToolPermissionScope,
  executor: DbOrTx = db
): Promise<AssistantToolPermissions> {
  const [row] = await executor
    .select()
    .from(assistantToolPermission)
    .where(
      and(
        eq(assistantToolPermission.organizationId, scope.organizationId),
        eq(assistantToolPermission.userId, scope.userId),
        eq(assistantToolPermission.credentialId, scope.credentialId)
      )
    )
    .limit(1)
  return row ?? { revision: 0, readPolicy: 'allow', writePolicy: 'ask', overrides: {} }
}

/** Stale automatic grants become Ask; explicit blocks survive an operation revision. */
export function resolveAssistantToolPolicy(
  permissions: AssistantToolPermissions,
  toolId: string,
  operation: AssistantOperationMetadata
) {
  const override = permissions.overrides[toolId]
  if (override) {
    if (override.policy === 'block') return 'block'
    if (override.version !== operation.version) return 'ask'
    return override.policy
  }
  return operation.effect === 'read' ? permissions.readPolicy : permissions.writePolicy
}

/** Caller holds the account policy lock and has already checked the expected revision. */
export async function saveAssistantToolPermissions(
  scope: AssistantToolPermissionScope,
  permissions: AssistantToolPermissions,
  executor: DbOrTx
) {
  await executor
    .insert(assistantToolPermission)
    .values({ ...scope, ...permissions })
    .onConflictDoUpdate({
      target: [
        assistantToolPermission.organizationId,
        assistantToolPermission.userId,
        assistantToolPermission.credentialId,
      ],
      set: { ...permissions, updatedAt: new Date() },
    })
}
