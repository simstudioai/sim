import { member, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { revokeUserSessionsTx } from '@/lib/organizations/members/revocation'

const logger = createLogger('OrganizationMemberLifecycle')

/**
 * Member lifecycle primitives shared by the settings UI and directory
 * provisioning: suspension, and role changes. Removal lives with the billing
 * membership primitives; live-access revocation lives in `revocation.ts`.
 */

/**
 * Who applied a suspension. A source only ever lifts its own, so a second source
 * added later cannot have its suspensions undone by a directory sync.
 */
export type SuspensionSource = 'scim'

export interface SuspendMemberResult {
  suspended: boolean
  sessionsRevoked: number
}

/**
 * Suspends an account: sign-in is refused, API keys stop authenticating, and
 * everything the person owns is left exactly as it was.
 *
 * Deliberately not the platform ban. A ban runs `disableUserResources`, which
 * archives every workspace the user owns and deletes their API keys, and there
 * is no server-side path to undo it. A directory deactivation is routine and
 * reversible — someone on leave, or moved between teams — so it must not destroy
 * the work they own. That includes their API keys: the key rows stay, and the
 * authentication paths refuse them while `suspendedAt` is set, so reactivation
 * restores every automation exactly as it was.
 */
export async function suspendMemberTx(
  tx: DbOrTx,
  params: { userId: string; organizationId: string; source: SuspensionSource }
): Promise<SuspendMemberResult> {
  await acquireOrganizationUserMutationLocks(tx, {
    userId: params.userId,
    organizationIds: [params.organizationId],
  })

  const [membership] = await tx
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, params.organizationId), eq(member.userId, params.userId)))
    .limit(1)
  if (!membership) throw new OrchestrationError('not_found', 'Member not found')
  if (membership.role === 'owner') {
    throw new OrchestrationError(
      'conflict',
      'The organization owner cannot be suspended. Transfer ownership in Sim first.'
    )
  }

  const [updated] = await tx
    .update(user)
    .set({ suspendedAt: new Date(), suspensionSource: params.source, updatedAt: new Date() })
    .where(and(eq(user.id, params.userId), isNull(user.suspendedAt)))
    .returning({ id: user.id })

  const sessions = await revokeUserSessionsTx(tx, {
    userId: params.userId,
    organizationId: params.organizationId,
  })

  return { suspended: Boolean(updated), sessionsRevoked: sessions.revoked }
}

/** Lifts a suspension, but only one raised by the same source. */
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
