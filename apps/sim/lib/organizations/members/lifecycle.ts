import { apiKey, member, organization, session as sessionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import {
  invalidateMembershipCache,
  invalidateSecurityPolicyVersionCache,
} from '@/lib/auth/security-policy'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('OrganizationMemberLifecycle')

/**
 * Member lifecycle primitives shared by the settings UI and directory
 * provisioning.
 *
 * Before this module each of these lived inline in the route that needed it, and
 * two of them did not exist at all: removing a member left their sessions and
 * API keys working until the cookie cache lapsed. Directory deprovisioning made
 * that gap load-bearing, so the behavior is defined once here.
 */

/** Why an account is suspended. SCIM only ever lifts a suspension it applied. */
export type SuspensionSource = 'scim' | 'admin'

export interface RevokeSessionsResult {
  revoked: number
}

/**
 * Deletes a user's sessions and forces cached session cookies in the
 * organization to re-read the database.
 *
 * Both halves commit together. Deleting sessions without bumping the version
 * would leave the signed cookie cache authenticating a deleted session for up
 * to five minutes, which is precisely the window a deprovisioning exists to
 * close.
 *
 * Impersonation sessions are spared: they are platform support tooling, not the
 * member's own access.
 */
export async function revokeUserSessionsTx(
  tx: DbOrTx,
  params: { userId: string; organizationId: string; spareSessionToken?: string }
): Promise<RevokeSessionsResult> {
  const deleted = await tx
    .delete(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, params.userId),
        isNull(sessionTable.impersonatedBy),
        ...(params.spareSessionToken ? [ne(sessionTable.token, params.spareSessionToken)] : [])
      )
    )
    .returning({ id: sessionTable.id })

  await tx
    .update(organization)
    .set({ securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1` })
    .where(eq(organization.id, params.organizationId))

  return { revoked: deleted.length }
}

/**
 * Drops the caches that make a revocation visible to the next request.
 *
 * Separate from the transaction on purpose: an in-process cache cleared before
 * the commit lands would be repopulated with the pre-commit answer.
 */
export function invalidateAfterSessionRevocation(params: {
  userId: string
  organizationId: string
}): void {
  invalidateSecurityPolicyVersionCache(params.organizationId)
  invalidateMembershipCache(params.userId)
}

/**
 * Deletes a user's personal API keys.
 *
 * Workspace keys are left alone: they belong to the workspace and are shared, so
 * one person's departure must not break every automation using them.
 */
export async function revokePersonalApiKeysTx(
  tx: DbOrTx,
  params: { userId: string }
): Promise<{ revoked: number }> {
  const deleted = await tx
    .delete(apiKey)
    .where(and(eq(apiKey.userId, params.userId), eq(apiKey.type, 'personal')))
    .returning({ id: apiKey.id })
  return { revoked: deleted.length }
}

export interface SuspendMemberResult {
  suspended: boolean
  sessionsRevoked: number
  apiKeysRevoked: number
}

/**
 * Suspends an account: sign-in is refused, API keys stop authenticating, and
 * everything the person owns is left exactly as it was.
 *
 * Deliberately not the platform ban. A ban runs `disableUserResources`, which
 * archives every workspace the user owns and deletes their API keys, and there
 * is no server-side path to undo it. A directory deactivation is routine and
 * reversible — someone on leave, or moved between teams — so it must not destroy
 * the work they own.
 */
export async function suspendMemberTx(
  tx: DbOrTx,
  params: { userId: string; organizationId: string; source: SuspensionSource }
): Promise<SuspendMemberResult> {
  await acquireOrganizationUserMutationLocks(tx, {
    userId: params.userId,
    organizationIds: [params.organizationId],
  })

  const [updated] = await tx
    .update(user)
    .set({ suspendedAt: new Date(), suspensionSource: params.source, updatedAt: new Date() })
    .where(and(eq(user.id, params.userId), isNull(user.suspendedAt)))
    .returning({ id: user.id })

  const sessions = await revokeUserSessionsTx(tx, {
    userId: params.userId,
    organizationId: params.organizationId,
  })
  const keys = await revokePersonalApiKeysTx(tx, { userId: params.userId })

  return {
    suspended: Boolean(updated),
    sessionsRevoked: sessions.revoked,
    apiKeysRevoked: keys.revoked,
  }
}

/**
 * Lifts a suspension, but only one raised by the same source.
 *
 * An administrator who suspends someone during an investigation must not have
 * that undone by the next directory sync, so a SCIM reactivation leaves an
 * `admin` suspension in place.
 */
export async function unsuspendMemberTx(
  tx: DbOrTx,
  params: { userId: string; source: SuspensionSource }
): Promise<{ unsuspended: boolean }> {
  const [updated] = await tx
    .update(user)
    .set({ suspendedAt: null, suspensionSource: null, updatedAt: new Date() })
    .where(and(eq(user.id, params.userId), eq(user.suspensionSource, params.source)))
    .returning({ id: user.id })
  return { unsuspended: Boolean(updated) }
}

export type OrganizationMemberRole = 'admin' | 'member'

export type ChangeMemberRoleResult =
  | { changed: true; from: string; to: OrganizationMemberRole }
  | { changed: false; role: string }

/**
 * Changes a member's organization role.
 *
 * Ownership is out of scope in both directions: the owner's role cannot be
 * lowered here, and no caller can raise someone to owner. Transferring ownership
 * moves billing and the last-owner guarantee with it, which is its own operation.
 */
export async function changeMemberRoleTx(
  tx: DbOrTx,
  params: { organizationId: string; userId: string; role: OrganizationMemberRole }
): Promise<ChangeMemberRoleResult> {
  await acquireOrganizationUserMutationLocks(tx, {
    userId: params.userId,
    organizationIds: [params.organizationId],
  })

  const [current] = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, params.organizationId), eq(member.userId, params.userId)))
    .limit(1)

  if (!current) throw new OrchestrationError('not_found', 'Member not found')
  if (current.role === 'owner') {
    throw new OrchestrationError('conflict', 'The organization owner’s role cannot be changed')
  }
  if (current.role === params.role) return { changed: false, role: current.role }

  await tx.update(member).set({ role: params.role }).where(eq(member.id, current.id))
  logger.info('Changed organization member role', {
    organizationId: params.organizationId,
    userId: params.userId,
    from: current.role,
    to: params.role,
  })
  return { changed: true, from: current.role, to: params.role }
}

/** True when the account is currently suspended. */
export function isSuspended(row: { suspendedAt: Date | null }): boolean {
  return row.suspendedAt !== null
}
