/**
 * Organization Membership Management
 *
 * Shared helpers for adding and removing users from organizations.
 * Used by both regular routes and admin routes to ensure consistent business logic.
 */

import { db } from '@sim/db'
import {
  invitation,
  member,
  organization,
  permissionGroupMember,
  permissions,
  subscription as subscriptionTable,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  assertNoUnresolvedEnterpriseIssuance,
  resolveEnterpriseMetadataIntent,
} from '@/lib/billing/enterprise-outbox'
import { isPaid, sqlIsPro } from '@/lib/billing/plan-helpers'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  getEffectiveSeats,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { revokeWorkspaceCredentialMembershipsTx } from '@/lib/credentials/access'
import type { DbOrTx } from '@/lib/db/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import {
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
  WorkspaceBillingAccountRemovalError,
} from '@/lib/workspaces/utils'

export { WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR } from '@/lib/workspaces/utils'

const logger = createLogger('OrganizationMembership')

const ORG_MEMBERSHIP_LOCK_TIMEOUT_MS = 5_000

/** Serializes organization-wide owner, seat, move, and membership decisions. */
export async function acquireOrganizationMutationLock(
  tx: DbOrTx,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${ORG_MEMBERSHIP_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization-mutation:${organizationId}`}, 0))`
  )
}

/**
 * Serialize concurrent membership changes for a `(user, org)` pair via a
 * transaction-scoped Postgres advisory lock. Callers acquire it at the top of
 * the transaction that both decides and mutates membership — removal does
 * check-then-delete; acceptance re-checks the member then grants — so an invite
 * acceptance can't interleave with a removal and leave the user with workspace
 * access but no org membership (or vice versa).
 *
 * `pg_advisory_xact_lock` auto-releases at transaction end, so there's no
 * session lock to leak onto a pooled connection, and the `lock_timeout` bounds
 * the wait (it raises SQLSTATE 55P03 instead of hanging) if a holder is stuck.
 */
export async function acquireOrgMembershipLock(
  tx: DbOrTx,
  userId: string,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${ORG_MEMBERSHIP_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${organizationId}`}, 0))`
  )
}

export type BillingBlockReason = 'payment_failed' | 'dispute'

/**
 * Get all member user IDs for an organization
 */
export async function getOrgMemberIds(organizationId: string): Promise<string[]> {
  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))

  return members.map((m) => m.userId)
}

/**
 * Block all members of an organization for billing reasons
 * Returns the number of members actually blocked
 *
 * Reason priority: dispute > payment_failed
 * A payment_failed block won't overwrite an existing dispute block
 */
export async function blockOrgMembers(
  organizationId: string,
  reason: BillingBlockReason
): Promise<number> {
  const memberIds = await getOrgMemberIds(organizationId)

  if (memberIds.length === 0) {
    return 0
  }

  // Don't overwrite dispute blocks with payment_failed (dispute is higher priority)
  const whereClause =
    reason === 'payment_failed'
      ? and(
          inArray(userStats.userId, memberIds),
          or(ne(userStats.billingBlockedReason, 'dispute'), isNull(userStats.billingBlockedReason))
        )
      : inArray(userStats.userId, memberIds)

  const result = await db
    .update(userStats)
    .set({ billingBlocked: true, billingBlockedReason: reason })
    .where(whereClause)
    .returning({ userId: userStats.userId })

  return result.length
}

/**
 * Unblock all members of an organization blocked for a specific reason
 * Only unblocks members blocked for the specified reason (not other reasons)
 * Returns the number of members actually unblocked
 */
export async function unblockOrgMembers(
  organizationId: string,
  reason: BillingBlockReason
): Promise<number> {
  const memberIds = await getOrgMemberIds(organizationId)

  if (memberIds.length === 0) {
    return 0
  }

  const result = await db
    .update(userStats)
    .set({ billingBlocked: false, billingBlockedReason: null })
    .where(and(inArray(userStats.userId, memberIds), eq(userStats.billingBlockedReason, reason)))
    .returning({ userId: userStats.userId })

  return result.length
}

export interface RestoreProResult {
  restored: boolean
  usageRestored: boolean
  subscriptionId?: string
}

/**
 * Restore a user's personal Pro subscription if it was paused
 * (`cancelAtPeriodEnd = true`) and merge any snapshotted Pro usage back
 * into their current-period usage.
 *
 * All DB mutations run inside a single transaction so partial progress
 * cannot be committed: either both the subscription un-pause and the
 * usage snapshot merge succeed, or neither does. Errors propagate to
 * the caller so webhook handlers can rely on Stripe retry semantics.
 *
 * Idempotent:
 *   - Early returns when the user has no paused Pro subscription, so
 *     re-runs after a successful restore are no-ops.
 *   - The snapshot merge only runs when `proPeriodCostSnapshot > 0`,
 *     so a second call after a prior success (which zeroes the
 *     snapshot) does nothing.
 *
 * Called when:
 *   - A member leaves a team (via `removeUserFromOrganization`).
 *   - A team subscription ends (members stay but get Pro restored).
 */
export async function restoreUserProSubscription(userId: string): Promise<RestoreProResult> {
  const result: RestoreProResult = {
    restored: false,
    usageRestored: false,
  }

  await db.transaction(async (tx) => {
    // The personal subscription row is the cross-organization serialization
    // point shared with paid-org joins. Lock and re-read it before deciding to
    // restore so a concurrent join cannot commit membership while this path
    // leaves the user's personal Pro unpaused.
    const [personalPro] = await tx
      .select()
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, userId),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
          sqlIsPro(subscriptionTable.plan)
        )
      )
      .for('update')
      .limit(1)

    if (!personalPro?.cancelAtPeriodEnd || !personalPro.stripeSubscriptionId) return
    result.subscriptionId = personalPro.id

    const organizationMemberships = await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
    if (organizationMemberships.length > 0) {
      const paidOrganizationSubscriptions = await tx
        .select({ plan: subscriptionTable.plan })
        .from(subscriptionTable)
        .where(
          and(
            inArray(
              subscriptionTable.referenceId,
              organizationMemberships.map((membership) => membership.organizationId)
            ),
            inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
      if (paidOrganizationSubscriptions.some((orgSubscription) => isPaid(orgSubscription.plan))) {
        return
      }
    }

    await tx
      .update(subscriptionTable)
      .set({ cancelAtPeriodEnd: false })
      .where(eq(subscriptionTable.id, personalPro.id))

    await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, {
      stripeSubscriptionId: personalPro.stripeSubscriptionId,
      subscriptionId: personalPro.id,
      reason: 'member-left-paid-org',
    })

    result.restored = true

    const [stats] = await tx
      .select({
        currentPeriodCost: userStats.currentPeriodCost,
        proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (!stats) {
      return
    }

    const currentNum = toNumber(toDecimal(stats.currentPeriodCost))
    const snapshotNum = toNumber(toDecimal(stats.proPeriodCostSnapshot))

    if (snapshotNum <= 0) {
      return
    }

    const restoredUsage = (currentNum + snapshotNum).toString()

    await tx
      .update(userStats)
      .set({
        currentPeriodCost: restoredUsage,
        proPeriodCostSnapshot: '0',
        proPeriodCostSnapshotAt: null,
      })
      .where(eq(userStats.userId, userId))

    result.usageRestored = true

    logger.info('Restored Pro usage snapshot', {
      userId,
      previousUsage: currentNum,
      snapshotUsage: snapshotNum,
      restoredUsage,
    })
  })

  if (result.restored) {
    logger.info('Restored personal Pro subscription (DB committed, Stripe queued)', {
      userId,
      subscriptionId: result.subscriptionId,
      usageRestored: result.usageRestored,
    })
  }

  return result
}

export interface AddMemberParams {
  userId: string
  organizationId: string
  role: 'admin' | 'member' | 'owner'
  /** Skip Pro snapshot/cancellation logic (default: false) */
  skipBillingLogic?: boolean
  /** Skip seat validation (default: false) */
  skipSeatValidation?: boolean
  /** When provided, the acceptor's own pending invitation is excluded from the seat count during validation. */
  acceptingInvitationId?: string
}

export interface AddMemberResult {
  success: boolean
  memberId?: string
  error?: string
  failureCode?: MembershipAdditionFailureCode
  billingActions: {
    proUsageSnapshotted: boolean
    /**
     * True when this function marked the user's personal Pro for
     * cancellation at period end AND enqueued the Stripe sync via
     * the outbox. Callers should NOT make a Stripe call themselves.
     */
    proCancelledAtPeriodEnd: boolean
  }
}

export interface EnsureMemberResult extends AddMemberResult {
  alreadyMember: boolean
  existingOrgId?: string
}

export interface RemoveMemberParams {
  userId: string
  organizationId: string
  memberId: string
  /** Skip departed usage capture and Pro restoration (default: false) */
  skipBillingLogic?: boolean
  /**
   * Only remove the member when they hold no remaining permission on any of the
   * org's workspaces, evaluated atomically under the membership lock. Used by
   * the workspace-removal path so a concurrent invite acceptance can't be raced
   * into a "workspace access but no membership" state. When access remains, the
   * member is kept and the result has `removed: false`.
   */
  requireNoOrgWorkspaceAccess?: boolean
}

export interface RemoveMemberResult {
  success: boolean
  error?: string
  /**
   * Whether the member row was actually deleted. `false` (with `success: true`)
   * when `requireNoOrgWorkspaceAccess` was set and the user still had workspace
   * access, so the membership was intentionally left in place.
   */
  removed?: boolean
  billingActions: {
    usageCaptured: number
    proRestored: boolean
    usageRestored: boolean
    workspaceAccessRevoked: number
    pendingInvitationsCancelled: number
  }
}

export interface RemoveExternalWorkspaceAccessResult {
  success: boolean
  error?: string
  workspaceAccessRevoked: number
  permissionGroupsRevoked: number
  credentialMembershipsRevoked: number
  pendingInvitationsCancelled: number
}

export type MembershipAdditionFailureCode =
  | 'user-not-found'
  | 'organization-not-found'
  | 'already-member'
  | 'already-in-other-organization'
  | 'no-seats-available'

async function reassignOwnedOrganizationWorkspacesTx({
  tx,
  userId,
  organizationId,
  workspaceIds,
}: {
  tx: DbOrTx
  userId: string
  organizationId: string
  workspaceIds: string[]
}) {
  if (workspaceIds.length === 0) return 0

  const [ownerMembership] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  const ownerId = ownerMembership?.userId
  if (!ownerId || ownerId === userId) return 0

  const reassignedWorkspaces = await tx
    .update(workspace)
    .set({ ownerId, updatedAt: new Date() })
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.ownerId, userId),
        inArray(workspace.id, workspaceIds)
      )
    )
    .returning({
      id: workspace.id,
    })

  if (reassignedWorkspaces.length === 0) {
    return 0
  }

  const now = new Date()
  await tx
    .insert(permissions)
    .values(
      reassignedWorkspaces.map((row) => ({
        id: generateId(),
        userId: ownerId,
        entityType: 'workspace',
        entityId: row.id,
        permissionType: 'admin' as const,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [permissions.userId, permissions.entityType, permissions.entityId],
      set: { permissionType: 'admin', updatedAt: now },
    })

  return reassignedWorkspaces.length
}

interface MembershipValidationResult {
  canAdd: boolean
  reason?: string
  failureCode?: MembershipAdditionFailureCode
  existingOrgId?: string
  seatValidation?: {
    currentSeats: number
    maxSeats: number
    availableSeats: number
  }
}

export async function ensureUserInOrganization(
  params: AddMemberParams
): Promise<EnsureMemberResult> {
  const existingMembership = await getUserOrganization(params.userId)

  if (existingMembership?.organizationId === params.organizationId) {
    return {
      success: true,
      memberId: existingMembership.memberId,
      alreadyMember: true,
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    }
  }

  if (existingMembership) {
    return {
      success: false,
      alreadyMember: false,
      existingOrgId: existingMembership.organizationId,
      failureCode: 'already-in-other-organization',
      error:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      billingActions: {
        proUsageSnapshotted: false,
        proCancelledAtPeriodEnd: false,
      },
    }
  }

  const result = await addUserToOrganization(params)

  return {
    ...result,
    alreadyMember: false,
  }
}

/**
 * Transaction-enlisted invitation acceptance path. Membership, personal-Pro
 * handling, invitation status, and workspace permissions all commit or roll
 * back together in the caller's transaction.
 */
export async function ensureUserInOrganizationTx(
  tx: DbOrTx,
  params: AddMemberParams
): Promise<EnsureMemberResult> {
  const {
    userId,
    organizationId,
    role,
    skipBillingLogic = false,
    skipSeatValidation = false,
  } = params
  const emptyBillingActions = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  await acquireOrganizationMutationLock(tx, organizationId)
  await acquireOrgMembershipLock(tx, userId, organizationId)

  const existingMemberships = await tx
    .select({ id: member.id, organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  const sameOrganization = existingMemberships.find(
    (membership) => membership.organizationId === organizationId
  )
  if (sameOrganization) {
    return {
      success: true,
      memberId: sameOrganization.id,
      alreadyMember: true,
      billingActions: emptyBillingActions,
    }
  }
  if (existingMemberships.length > 0) {
    return {
      success: false,
      alreadyMember: false,
      existingOrgId: existingMemberships[0].organizationId,
      failureCode: 'already-in-other-organization',
      error:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      billingActions: emptyBillingActions,
    }
  }

  const [[userRow], [organizationRow]] = await Promise.all([
    tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1),
    tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
  ])
  if (!userRow) {
    return {
      success: false,
      alreadyMember: false,
      failureCode: 'user-not-found',
      error: 'User not found',
      billingActions: emptyBillingActions,
    }
  }
  if (!organizationRow) {
    return {
      success: false,
      alreadyMember: false,
      failureCode: 'organization-not-found',
      error: 'Organization not found',
      billingActions: emptyBillingActions,
    }
  }

  if (isBillingEnabled && !skipSeatValidation) {
    const [organizationSubscription] = await tx
      .select()
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, organizationId),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
        )
      )
      .limit(1)
    if (!organizationSubscription || !isPaid(organizationSubscription.plan)) {
      return {
        success: false,
        alreadyMember: false,
        failureCode: 'no-seats-available',
        error: 'No active paid organization subscription found',
        billingActions: emptyBillingActions,
      }
    }

    // Acceptance validates only committed members. Pending invitations never
    // reserve Enterprise capacity; serialized acceptances consume seats one by one.
    const [memberCountRow] = await tx
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    const canonicalSeats = getEffectiveSeats(organizationSubscription)
    const metadataIntent =
      organizationSubscription.plan === 'enterprise'
        ? await resolveEnterpriseMetadataIntent(
            tx,
            organizationSubscription.id,
            organizationSubscription.metadata
          )
        : null
    const effectiveSeats = metadataIntent?.effectiveSeatCapacity ?? canonicalSeats
    if ((memberCountRow?.value ?? 0) >= effectiveSeats) {
      return {
        success: false,
        alreadyMember: false,
        failureCode: 'no-seats-available',
        error: 'No available organization seats',
        billingActions: emptyBillingActions,
      }
    }
  }

  const memberId = generateId()
  await tx.insert(member).values({
    id: memberId,
    userId,
    organizationId,
    role,
    createdAt: new Date(),
  })

  const billingActions = skipBillingLogic
    ? emptyBillingActions
    : await (async () => {
        const [organizationSubscription] = await tx
          .select({ plan: subscriptionTable.plan })
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, organizationId),
              inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1)
        return organizationSubscription && isPaid(organizationSubscription.plan)
          ? applyPaidOrgJoinBillingTx(tx, userId, organizationId)
          : emptyBillingActions
      })()

  return {
    success: true,
    memberId,
    alreadyMember: false,
    billingActions,
  }
}

/**
 * Validate if a user can be added to an organization.
 * Checks single-org constraint and seat availability.
 */
async function validateMembershipAddition(
  userId: string,
  organizationId: string,
  options: { acceptingInvitationId?: string } = {}
): Promise<MembershipValidationResult> {
  const [userData] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)

  if (!userData) {
    return { canAdd: false, reason: 'User not found', failureCode: 'user-not-found' }
  }

  const [orgData] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  if (!orgData) {
    return {
      canAdd: false,
      reason: 'Organization not found',
      failureCode: 'organization-not-found',
    }
  }

  const existingMemberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))

  if (existingMemberships.length > 0) {
    const isAlreadyMemberOfThisOrg = existingMemberships.some(
      (m) => m.organizationId === organizationId
    )

    if (isAlreadyMemberOfThisOrg) {
      return {
        canAdd: false,
        reason: 'User is already a member of this organization',
        failureCode: 'already-member',
      }
    }

    return {
      canAdd: false,
      reason:
        'User is already a member of another organization. Users can only belong to one organization at a time.',
      failureCode: 'already-in-other-organization',
      existingOrgId: existingMemberships[0].organizationId,
    }
  }

  const seatValidation = await validateSeatAvailability(organizationId, 1, {
    excludePendingInvitationId: options.acceptingInvitationId,
  })
  if (!seatValidation.canInvite) {
    return {
      canAdd: false,
      reason: seatValidation.reason || 'No seats available',
      failureCode: 'no-seats-available',
      seatValidation: {
        currentSeats: seatValidation.currentSeats,
        maxSeats: seatValidation.maxSeats,
        availableSeats: seatValidation.availableSeats,
      },
    }
  }

  return {
    canAdd: true,
    seatValidation: {
      currentSeats: seatValidation.currentSeats,
      maxSeats: seatValidation.maxSeats,
      availableSeats: seatValidation.availableSeats,
    },
  }
}

interface PaidOrgJoinBillingActions {
  proUsageSnapshotted: boolean
  proCancelledAtPeriodEnd: boolean
}

/**
 * Applies the billing side-effects of a user joining a paid (Team/Enterprise)
 * organization inside an existing transaction:
 *   - snapshots current Pro usage so new usage attributes to the org;
 *   - marks personal Pro subscription `cancelAtPeriodEnd=true` and enqueues
 *     the Stripe sync via the outbox;
 *   - transfers personal storage bytes into the org's pool.
 *
 * Idempotent: re-running is a no-op when Pro is already flagged cancel-at-period-end
 * and the user's storage is already transferred (zeroed).
 */
async function applyPaidOrgJoinBillingTx(
  tx: DbOrTx,
  userId: string,
  organizationId: string
): Promise<PaidOrgJoinBillingActions> {
  const actions: PaidOrgJoinBillingActions = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  const [personalPro] = await tx
    .select()
    .from(subscriptionTable)
    .where(
      and(
        eq(subscriptionTable.referenceId, userId),
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
        sqlIsPro(subscriptionTable.plan)
      )
    )
    .for('update')
    .limit(1)

  if (personalPro && !personalPro.cancelAtPeriodEnd) {
    const [userStatsRow] = await tx
      .select({ currentPeriodCost: userStats.currentPeriodCost })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (userStatsRow) {
      const currentProUsage = userStatsRow.currentPeriodCost || '0'

      await tx
        .update(userStats)
        .set({
          proPeriodCostSnapshot: currentProUsage,
          proPeriodCostSnapshotAt: new Date(),
          currentPeriodCost: '0',
          currentPeriodCopilotCost: '0',
        })
        .where(eq(userStats.userId, userId))

      actions.proUsageSnapshotted = true

      logger.info('Snapshotted Pro usage when joining paid org', {
        userId,
        proUsageSnapshot: currentProUsage,
        organizationId,
      })
    }

    await tx
      .update(subscriptionTable)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(subscriptionTable.id, personalPro.id))

    if (personalPro.stripeSubscriptionId) {
      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CANCEL_AT_PERIOD_END, {
        stripeSubscriptionId: personalPro.stripeSubscriptionId,
        subscriptionId: personalPro.id,
        reason: 'joined-paid-org',
      })
    }

    actions.proCancelledAtPeriodEnd = true

    logger.info('Marked personal Pro for cancellation at period end (Stripe queued)', {
      userId,
      subscriptionId: personalPro.id,
      organizationId,
    })
  }

  const storageRows = await tx
    .select({ storageUsedBytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .for('update')
    .limit(1)

  const bytesToTransfer = storageRows[0]?.storageUsedBytes ?? 0
  if (bytesToTransfer > 0) {
    await tx
      .update(organization)
      .set({
        storageUsedBytes: sql`${organization.storageUsedBytes} + ${bytesToTransfer}`,
      })
      .where(eq(organization.id, organizationId))

    await tx.update(userStats).set({ storageUsedBytes: 0 }).where(eq(userStats.userId, userId))

    logger.info('Transferred personal storage bytes to org pool on join', {
      userId,
      organizationId,
      bytes: bytesToTransfer,
    })
  }

  return actions
}

/**
 * Re-applies paid-org join billing for a user who is already a member of
 * the organization. Used on re-upgrade after a dormant transition: members
 * kept their org membership but had their personal Pro subscriptions
 * restored (`cancelAtPeriodEnd=false`) during the cancel/downgrade. When
 * the org becomes paid again, those Pros must be re-paused so the user
 * isn't double-billed.
 *
 * No-op when the org has no active Team/Enterprise subscription.
 */
export async function reapplyPaidOrgJoinBillingForExistingMember(
  userId: string,
  organizationId: string
): Promise<PaidOrgJoinBillingActions> {
  return db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    const [existingMembership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1)
    if (!existingMembership) {
      return { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false }
    }
    return reapplyPaidOrgJoinBillingForExistingMemberTx(tx, userId, organizationId)
  })
}

/**
 * Transaction-enlisted variant used by subscription webhooks. Keeping the
 * subscription upsert, effective-limit update, provisioning completion, and
 * existing-member Pro handling in one transaction prevents a partially
 * applied Enterprise entitlement when Stripe retries a failed delivery.
 *
 * The caller must hold the organization mutation lock before invoking this
 * helper so a concurrent member removal cannot fall between the member census
 * and the personal-Pro transition.
 */
export async function reapplyPaidOrgJoinBillingForExistingMemberTx(
  tx: DbOrTx,
  userId: string,
  organizationId: string
): Promise<PaidOrgJoinBillingActions> {
  const [orgSub] = await tx
    .select({ plan: subscriptionTable.plan })
    .from(subscriptionTable)
    .where(
      and(
        eq(subscriptionTable.referenceId, organizationId),
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
      )
    )
    .limit(1)

  if (!orgSub || !isPaid(orgSub.plan)) {
    return { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false }
  }

  return applyPaidOrgJoinBillingTx(tx, userId, organizationId)
}

/**
 * Add a user to an organization with full billing logic.
 *
 * Handles:
 * - Single organization constraint validation
 * - Seat availability validation
 * - Member record creation
 * - Pro usage snapshot when joining paid team
 * - Pro subscription cancellation at period end
 * - Usage limit sync
 */
export async function addUserToOrganization(params: AddMemberParams): Promise<AddMemberResult> {
  const {
    userId,
    organizationId,
    role,
    skipBillingLogic = false,
    skipSeatValidation = false,
    acceptingInvitationId,
  } = params

  const billingActions: AddMemberResult['billingActions'] = {
    proUsageSnapshotted: false,
    proCancelledAtPeriodEnd: false,
  }

  try {
    if (!skipSeatValidation) {
      const validation = await validateMembershipAddition(userId, organizationId, {
        acceptingInvitationId,
      })
      if (!validation.canAdd) {
        return {
          success: false,
          error: validation.reason,
          failureCode: validation.failureCode,
          billingActions,
        }
      }
    } else {
      const existingMemberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId))

      if (existingMemberships.length > 0) {
        const isAlreadyMemberOfThisOrg = existingMemberships.some(
          (m) => m.organizationId === organizationId
        )

        if (isAlreadyMemberOfThisOrg) {
          return {
            success: false,
            error: 'User is already a member of this organization',
            failureCode: 'already-member',
            billingActions,
          }
        }

        return {
          success: false,
          error:
            'User is already a member of another organization. Users can only belong to one organization at a time.',
          failureCode: 'already-in-other-organization',
          billingActions,
        }
      }
    }

    const added = await db.transaction((tx) =>
      ensureUserInOrganizationTx(tx, {
        userId,
        organizationId,
        role,
        skipBillingLogic,
        skipSeatValidation,
        acceptingInvitationId,
      })
    )
    if (!added.success || !added.memberId || added.alreadyMember) {
      return {
        success: false,
        error: added.alreadyMember ? 'User is already a member of this organization' : added.error,
        failureCode: added.alreadyMember ? 'already-member' : added.failureCode,
        billingActions: added.billingActions,
      }
    }

    const memberId = added.memberId
    billingActions.proUsageSnapshotted = added.billingActions.proUsageSnapshotted
    billingActions.proCancelledAtPeriodEnd = added.billingActions.proCancelledAtPeriodEnd

    logger.info('Added user to organization', {
      userId,
      organizationId,
      role,
      memberId,
      billingActions,
    })

    return { success: true, memberId, billingActions }
  } catch (error) {
    logger.error('Failed to add user to organization', { userId, organizationId, error })
    return { success: false, error: 'Failed to add user to organization', billingActions }
  }
}

type InvitationRemovalScope = 'all' | 'external'

interface InvitationRemovalLockSnapshot {
  email: string | null
  invitationIds: string[]
  workspaceIds: string[]
}

class InvitationRemovalLockSetChangedError extends Error {
  constructor(readonly snapshot: InvitationRemovalLockSnapshot) {
    super('Invitation or workspace set changed while acquiring removal locks')
    this.name = 'InvitationRemovalLockSetChangedError'
  }
}

async function getInvitationRemovalLockSnapshot(
  executor: DbOrTx,
  params: { userId: string; organizationId: string; scope: InvitationRemovalScope }
): Promise<InvitationRemovalLockSnapshot> {
  const [targetUser] = await executor
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, params.userId))
    .limit(1)
  const workspaceRows = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.organizationId, params.organizationId))

  let invitationIds: string[] = []
  if (targetUser?.email) {
    const invitationRows = await executor
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, params.organizationId),
          eq(invitation.status, 'pending'),
          ...(params.scope === 'external' ? [eq(invitation.membershipIntent, 'external')] : []),
          sql`lower(${invitation.email}) = lower(${targetUser.email})`
        )
      )
    invitationIds = [...new Set(invitationRows.map((row) => row.id))].sort()
  }

  return {
    email: targetUser ? normalizeEmail(targetUser.email) : null,
    invitationIds,
    workspaceIds: [...new Set(workspaceRows.map((row) => row.id))].sort(),
  }
}

export async function withInvitationSafeOrganizationAccessMutation<T>(
  params: { userId: string; organizationId: string; scope: InvitationRemovalScope },
  operation: (tx: DbOrTx, locked: { workspaceIds: string[]; invitationIds: string[] }) => Promise<T>
): Promise<T> {
  let candidate = await getInvitationRemovalLockSnapshot(db, params)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        await acquireInvitationMutationLocks(tx, {
          invitationIds: candidate.invitationIds,
          workspaceIds: candidate.workspaceIds,
        })
        await acquireOrganizationMutationLock(tx, params.organizationId)
        await acquireOrgMembershipLock(tx, params.userId, params.organizationId)

        const current = await getInvitationRemovalLockSnapshot(tx, params)
        const candidateInvitations = new Set(candidate.invitationIds)
        const candidateWorkspaces = new Set(candidate.workspaceIds)
        const lockSetExpanded =
          current.email !== candidate.email ||
          current.invitationIds.some((id) => !candidateInvitations.has(id)) ||
          current.workspaceIds.some((id) => !candidateWorkspaces.has(id))
        if (lockSetExpanded) throw new InvitationRemovalLockSetChangedError(current)

        return operation(tx, {
          workspaceIds: current.workspaceIds,
          // Rows that stopped being pending while we waited are harmless: the
          // status predicate below turns them into no-ops, while their accepted
          // permissions are removed in this same transaction.
          invitationIds: candidate.invitationIds,
        })
      })
    } catch (error) {
      if (error instanceof InvitationRemovalLockSetChangedError) {
        candidate = error.snapshot
        continue
      }
      throw error
    }
  }

  throw new Error('Pending invitations changed repeatedly while removing organization access')
}

/**
 * Remove a user from an organization with full billing logic.
 *
 * Handles:
 * - Owner removal prevention
 * - Departed member usage capture
 * - Member record deletion
 * - Pro subscription restoration when leaving a paid team
 * - Pro usage restoration from snapshot
 *
 * Note: Users can only belong to one organization at a time.
 */
export async function removeUserFromOrganization(
  params: RemoveMemberParams
): Promise<RemoveMemberResult> {
  const {
    userId,
    organizationId,
    memberId,
    skipBillingLogic = false,
    requireNoOrgWorkspaceAccess = false,
  } = params

  const billingActions = {
    usageCaptured: 0,
    proRestored: false,
    usageRestored: false,
    workspaceAccessRevoked: 0,
    pendingInvitationsCancelled: 0,
  }

  try {
    const [existingMember] = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
      .limit(1)

    if (!existingMember) {
      return { success: false, error: 'Member not found', billingActions }
    }

    if (existingMember.role === 'owner') {
      return { success: false, error: 'Cannot remove organization owner', billingActions }
    }

    const result = await withInvitationSafeOrganizationAccessMutation(
      { userId, organizationId, scope: 'all' },
      async (tx, { workspaceIds, invitationIds }) => {
        if (requireNoOrgWorkspaceAccess && workspaceIds.length > 0) {
          const [remainingAccess] = await tx
            .select({ id: permissions.id })
            .from(permissions)
            .where(
              and(
                eq(permissions.userId, userId),
                eq(permissions.entityType, 'workspace'),
                inArray(permissions.entityId, workspaceIds)
              )
            )
            .limit(1)

          if (remainingAccess) {
            return { skipped: true as const }
          }
        }

        const deletedMember = await tx
          .delete(member)
          .where(and(eq(member.id, memberId), ne(member.role, 'owner')))
          .returning({ id: member.id })

        if (deletedMember.length === 0) {
          throw new Error(
            'Member could not be removed — they may have been promoted to owner concurrently'
          )
        }

        const cancelledInvitations = invitationIds.length
          ? await tx
              .update(invitation)
              .set({ status: 'cancelled', updatedAt: new Date() })
              .where(
                and(
                  inArray(invitation.id, invitationIds),
                  eq(invitation.organizationId, organizationId),
                  eq(invitation.status, 'pending')
                )
              )
              .returning({ id: invitation.id })
          : []

        const captureDepartedUsage = async () => {
          if (skipBillingLogic) return 0

          const [departingUserStats] = await tx
            .select({ currentPeriodCost: userStats.currentPeriodCost })
            .from(userStats)
            .where(eq(userStats.userId, userId))
            .for('update')
            .limit(1)

          const usage = toNumber(toDecimal(departingUserStats?.currentPeriodCost))
          if (usage <= 0) return 0

          await tx
            .update(organization)
            .set({
              departedMemberUsage: sql`${organization.departedMemberUsage} + ${usage}`,
            })
            .where(eq(organization.id, organizationId))

          await tx
            .update(userStats)
            .set({ currentPeriodCost: '0' })
            .where(eq(userStats.userId, userId))

          return usage
        }

        // Permission groups are organization-scoped, so a departing member's group
        // membership must be cleared whenever they leave the org — including the
        // zero-workspace early return below (a group can exist with members but no
        // workspaces).
        await tx
          .delete(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.userId, userId),
              eq(permissionGroupMember.organizationId, organizationId)
            )
          )

        if (workspaceIds.length === 0) {
          const capturedUsage = await captureDepartedUsage()

          return {
            skipped: false as const,
            workspaceIdsToRevoke: [] as string[],
            usageCaptured: capturedUsage,
            credentialMembershipsRevoked: 0,
            pendingInvitationsCancelled: cancelledInvitations.length,
          }
        }

        await reassignOwnedOrganizationWorkspacesTx({
          tx,
          userId,
          organizationId,
          workspaceIds,
        })

        const workflowOwnershipReassignment =
          await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
            tx,
            workspaceIds,
            departingUserId: userId,
          })
        if (workflowOwnershipReassignment.unresolved.length > 0) {
          throw new WorkspaceBillingAccountRemovalError()
        }

        const deletedPerms = await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              inArray(permissions.entityId, workspaceIds)
            )
          )
          .returning({ entityId: permissions.entityId })

        const credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx(
          tx,
          workspaceIds,
          userId
        )
        const capturedUsage = await captureDepartedUsage()

        return {
          skipped: false as const,
          workspaceIdsToRevoke: deletedPerms.map((row) => row.entityId),
          usageCaptured: capturedUsage,
          credentialMembershipsRevoked,
          pendingInvitationsCancelled: cancelledInvitations.length,
        }
      }
    )

    if (result.skipped) {
      logger.info('Skipped org removal: member still has workspace access', {
        organizationId,
        userId,
        memberId,
      })
      return { success: true, removed: false, billingActions }
    }

    billingActions.usageCaptured = result.usageCaptured
    billingActions.workspaceAccessRevoked = result.workspaceIdsToRevoke.length
    billingActions.pendingInvitationsCancelled = result.pendingInvitationsCancelled

    if (result.usageCaptured > 0) {
      logger.info('Captured departed member usage', {
        organizationId,
        userId,
        usage: result.usageCaptured,
      })
    }

    logger.info('Removed member from organization', {
      organizationId,
      userId,
      memberId,
      workspaceAccessRevoked: result.workspaceIdsToRevoke.length,
      credentialMembershipsRevoked: result.credentialMembershipsRevoked,
      pendingInvitationsCancelled: result.pendingInvitationsCancelled,
    })

    if (!skipBillingLogic) {
      try {
        const remainingPaidTeams = await db
          .select({ orgId: member.organizationId })
          .from(member)
          .where(eq(member.userId, userId))

        let hasAnyPaidTeam = false
        if (remainingPaidTeams.length > 0) {
          const orgIds = remainingPaidTeams.map((m) => m.orgId)
          const orgPaidSubs = await db
            .select()
            .from(subscriptionTable)
            .where(
              and(
                inArray(subscriptionTable.referenceId, orgIds),
                inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
              )
            )

          hasAnyPaidTeam = orgPaidSubs.some((s) => isPaid(s.plan))
        }

        if (!hasAnyPaidTeam) {
          const restoreResult = await restoreUserProSubscription(userId)
          billingActions.proRestored = restoreResult.restored
          billingActions.usageRestored = restoreResult.usageRestored

          await syncUsageLimitsFromSubscription(userId)
        }
      } catch (postRemoveError) {
        logger.error('Post-removal personal Pro restore check failed', {
          organizationId,
          userId,
          error: postRemoveError,
        })
      }
    }

    return { success: true, removed: true, billingActions }
  } catch (error) {
    if (error instanceof WorkspaceBillingAccountRemovalError) {
      return { success: false, error: error.message, billingActions }
    }

    logger.error('Failed to remove user from organization', {
      userId,
      organizationId,
      memberId,
      error,
    })
    return { success: false, error: 'Failed to remove user from organization', billingActions }
  }
}

/**
 * Removes a non-member's access from every workspace owned by an organization.
 * External workspace members have workspace permissions but no organization member row.
 */
export async function removeExternalUserFromOrganizationWorkspaces(params: {
  userId: string
  organizationId: string
}): Promise<RemoveExternalWorkspaceAccessResult> {
  const { userId, organizationId } = params

  try {
    const [existingMember] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)

    if (existingMember) {
      return {
        success: false,
        error: 'User is an organization member',
        workspaceAccessRevoked: 0,
        permissionGroupsRevoked: 0,
        credentialMembershipsRevoked: 0,
        pendingInvitationsCancelled: 0,
      }
    }

    const {
      workspaceAccessRevoked,
      permissionGroupsRevoked,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    } = await withInvitationSafeOrganizationAccessMutation(
      { userId, organizationId, scope: 'external' },
      async (tx, { workspaceIds, invitationIds }) => {
        const [currentMember] = await tx
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
          .limit(1)
        if (currentMember) throw new Error('User is an organization member')

        const cancelledInvitations = invitationIds.length
          ? await tx
              .update(invitation)
              .set({ status: 'cancelled', updatedAt: new Date() })
              .where(
                and(
                  inArray(invitation.id, invitationIds),
                  eq(invitation.organizationId, organizationId),
                  eq(invitation.status, 'pending'),
                  eq(invitation.membershipIntent, 'external')
                )
              )
              .returning({ id: invitation.id })
          : []

        const deletedPermissionGroups = await tx
          .delete(permissionGroupMember)
          .where(
            and(
              eq(permissionGroupMember.userId, userId),
              eq(permissionGroupMember.organizationId, organizationId)
            )
          )
          .returning({ id: permissionGroupMember.id })

        if (workspaceIds.length === 0) {
          return {
            workspaceAccessRevoked: 0,
            permissionGroupsRevoked: deletedPermissionGroups.length,
            credentialMembershipsRevoked: 0,
            pendingInvitationsCancelled: cancelledInvitations.length,
          }
        }

        await reassignOwnedOrganizationWorkspacesTx({
          tx,
          userId,
          organizationId,
          workspaceIds,
        })

        const workflowOwnershipReassignment =
          await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
            tx,
            workspaceIds,
            departingUserId: userId,
          })
        if (workflowOwnershipReassignment.unresolved.length > 0) {
          throw new WorkspaceBillingAccountRemovalError()
        }

        const deletedPermissions = await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, userId),
              eq(permissions.entityType, 'workspace'),
              inArray(permissions.entityId, workspaceIds)
            )
          )
          .returning({ entityId: permissions.entityId })

        const credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx(
          tx,
          workspaceIds,
          userId
        )

        return {
          workspaceAccessRevoked: deletedPermissions.length,
          permissionGroupsRevoked: deletedPermissionGroups.length,
          credentialMembershipsRevoked,
          pendingInvitationsCancelled: cancelledInvitations.length,
        }
      }
    )

    if (
      workspaceAccessRevoked === 0 &&
      permissionGroupsRevoked === 0 &&
      credentialMembershipsRevoked === 0 &&
      pendingInvitationsCancelled === 0
    ) {
      return {
        success: false,
        error: 'External workspace member not found',
        workspaceAccessRevoked,
        permissionGroupsRevoked,
        credentialMembershipsRevoked,
        pendingInvitationsCancelled,
      }
    }

    logger.info('Removed external workspace member from organization workspaces', {
      organizationId,
      userId,
      workspaceAccessRevoked,
      permissionGroupsRevoked,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    })

    return {
      success: true,
      workspaceAccessRevoked,
      permissionGroupsRevoked,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    }
  } catch (error) {
    if (error instanceof WorkspaceBillingAccountRemovalError) {
      return {
        success: false,
        error: error.message,
        workspaceAccessRevoked: 0,
        permissionGroupsRevoked: 0,
        credentialMembershipsRevoked: 0,
        pendingInvitationsCancelled: 0,
      }
    }

    logger.error('Failed to remove external workspace member from organization workspaces', {
      organizationId,
      userId,
      error,
    })
    return {
      success: false,
      error: 'Failed to remove external workspace member',
      workspaceAccessRevoked: 0,
      permissionGroupsRevoked: 0,
      credentialMembershipsRevoked: 0,
      pendingInvitationsCancelled: 0,
    }
  }
}

export interface TransferOwnershipParams {
  organizationId: string
  currentOwnerUserId: string
  newOwnerUserId: string
}

export interface TransferOwnershipResult {
  success: boolean
  error?: string
  workspacesReassigned: number
  billedAccountReassigned: number
  overageMigrated: string
  billingBlockInherited: boolean
}

export async function transferOrganizationOwnership(
  params: TransferOwnershipParams
): Promise<TransferOwnershipResult> {
  const { organizationId, currentOwnerUserId, newOwnerUserId } = params

  const result: TransferOwnershipResult = {
    success: false,
    workspacesReassigned: 0,
    billedAccountReassigned: 0,
    overageMigrated: '0',
    billingBlockInherited: false,
  }

  if (currentOwnerUserId === newOwnerUserId) {
    return { ...result, success: false, error: 'New owner must differ from current owner' }
  }

  try {
    await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, organizationId)
      await assertNoUnresolvedEnterpriseIssuance(tx, organizationId)
      const [currentOwnerMember] = await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, currentOwnerUserId),
            eq(member.role, 'owner')
          )
        )
        .limit(1)

      if (!currentOwnerMember) {
        throw new Error('Current user is not the owner of this organization')
      }

      const [newOwnerMember] = await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, newOwnerUserId)))
        .limit(1)

      if (!newOwnerMember) {
        throw new Error('Target user is not a member of this organization')
      }

      await tx.update(member).set({ role: 'admin' }).where(eq(member.id, currentOwnerMember.id))

      await tx.update(member).set({ role: 'owner' }).where(eq(member.id, newOwnerMember.id))

      const billedUpdate = await tx
        .update(workspace)
        .set({ billedAccountUserId: newOwnerUserId })
        .where(
          and(
            eq(workspace.organizationId, organizationId),
            eq(workspace.billedAccountUserId, currentOwnerUserId)
          )
        )
        .returning({ id: workspace.id })

      result.billedAccountReassigned = billedUpdate.length

      const ownerUpdate = await tx
        .update(workspace)
        .set({ ownerId: newOwnerUserId })
        .where(
          and(
            eq(workspace.organizationId, organizationId),
            eq(workspace.ownerId, currentOwnerUserId)
          )
        )
        .returning({ id: workspace.id })

      result.workspacesReassigned = ownerUpdate.length

      const reassignedWorkspaceIds = Array.from(
        new Set([...billedUpdate.map((w) => w.id), ...ownerUpdate.map((w) => w.id)])
      )

      if (reassignedWorkspaceIds.length > 0) {
        const now = new Date()
        await tx
          .insert(permissions)
          .values(
            reassignedWorkspaceIds.map((workspaceId) => ({
              id: generateId(),
              userId: newOwnerUserId,
              entityType: 'workspace' as const,
              entityId: workspaceId,
              permissionType: 'admin' as const,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .onConflictDoUpdate({
            target: [permissions.userId, permissions.entityType, permissions.entityId],
            set: { permissionType: 'admin', updatedAt: now },
          })
      }

      const [oldStats] = await tx
        .select({
          billedOverageThisPeriod: userStats.billedOverageThisPeriod,
          billingBlocked: userStats.billingBlocked,
          billingBlockedReason: userStats.billingBlockedReason,
        })
        .from(userStats)
        .where(eq(userStats.userId, currentOwnerUserId))
        .limit(1)

      if (oldStats) {
        await tx
          .insert(userStats)
          .values({
            id: generateId(),
            userId: newOwnerUserId,
            usageLimitUpdatedAt: new Date(),
          })
          .onConflictDoNothing({ target: userStats.userId })

        const overage = oldStats.billedOverageThisPeriod || '0'
        const overageNum = toNumber(toDecimal(overage))
        if (overageNum > 0) {
          await tx
            .update(userStats)
            .set({
              billedOverageThisPeriod: sql`${userStats.billedOverageThisPeriod} + ${overage}`,
            })
            .where(eq(userStats.userId, newOwnerUserId))

          await tx
            .update(userStats)
            .set({ billedOverageThisPeriod: '0' })
            .where(eq(userStats.userId, currentOwnerUserId))

          result.overageMigrated = overage
        }

        if (oldStats.billingBlocked) {
          const [newOwnerStats] = await tx
            .select({
              billingBlocked: userStats.billingBlocked,
              billingBlockedReason: userStats.billingBlockedReason,
            })
            .from(userStats)
            .where(eq(userStats.userId, newOwnerUserId))
            .limit(1)

          const newOwnerAlreadyBlocked = !!newOwnerStats?.billingBlocked
          const newOwnerReason = newOwnerStats?.billingBlockedReason ?? null
          const inheritedReason = oldStats.billingBlockedReason

          const shouldUpgradeReason =
            !newOwnerAlreadyBlocked ||
            (newOwnerReason === 'payment_failed' && inheritedReason === 'dispute')

          if (!newOwnerAlreadyBlocked) {
            await tx
              .update(userStats)
              .set({
                billingBlocked: true,
                billingBlockedReason: inheritedReason,
              })
              .where(eq(userStats.userId, newOwnerUserId))
            result.billingBlockInherited = true
          } else if (shouldUpgradeReason) {
            await tx
              .update(userStats)
              .set({ billingBlockedReason: inheritedReason })
              .where(eq(userStats.userId, newOwnerUserId))
            result.billingBlockInherited = true
          }
        }
      }

      const [orgSub] = await tx
        .select({
          id: subscriptionTable.id,
          stripeCustomerId: subscriptionTable.stripeCustomerId,
        })
        .from(subscriptionTable)
        .where(
          and(
            eq(subscriptionTable.referenceId, organizationId),
            inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
          )
        )
        .limit(1)

      if (orgSub?.stripeCustomerId) {
        await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_SYNC_CUSTOMER_CONTACT, {
          subscriptionId: orgSub.id,
          reason: 'ownership-transfer',
        })
      }
    })

    logger.info('Transferred organization ownership', {
      organizationId,
      currentOwnerUserId,
      newOwnerUserId,
      workspacesReassigned: result.workspacesReassigned,
      billedAccountReassigned: result.billedAccountReassigned,
      overageMigrated: result.overageMigrated,
      billingBlockInherited: result.billingBlockInherited,
    })

    return { ...result, success: true }
  } catch (error) {
    logger.error('Failed to transfer organization ownership', {
      organizationId,
      currentOwnerUserId,
      newOwnerUserId,
      error,
    })

    return {
      ...result,
      success: false,
      error: getErrorMessage(error, 'Failed to transfer ownership'),
    }
  }
}

export async function isSoleOwnerOfPaidOrganization(userId: string): Promise<{
  isBlocker: boolean
  organizationId?: string
  organizationName?: string
  plan?: string | null
}> {
  const [ownerMembership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    .limit(1)

  if (!ownerMembership) {
    return { isBlocker: false }
  }

  const [orgSub] = await db
    .select({ plan: subscriptionTable.plan })
    .from(subscriptionTable)
    .where(
      and(
        eq(subscriptionTable.referenceId, ownerMembership.organizationId),
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES)
      )
    )
    .limit(1)

  if (!orgSub || !isPaid(orgSub.plan)) {
    return { isBlocker: false }
  }

  const [orgRow] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, ownerMembership.organizationId))
    .limit(1)

  return {
    isBlocker: true,
    organizationId: ownerMembership.organizationId,
    organizationName: orgRow?.name,
    plan: orgSub.plan,
  }
}

export async function isUserMemberOfOrganization(
  userId: string,
  organizationId: string
): Promise<{ isMember: boolean; role?: string; memberId?: string }> {
  const [memberRecord] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  if (memberRecord) {
    return { isMember: true, role: memberRecord.role, memberId: memberRecord.id }
  }

  return { isMember: false }
}

/**
 * Get user's current organization membership (if any).
 */
export async function getUserOrganization(
  userId: string,
  executor: DbOrTx = db
): Promise<{ organizationId: string; role: string; memberId: string } | null> {
  const [memberRecord] = await executor
    .select({
      organizationId: member.organizationId,
      role: member.role,
      memberId: member.id,
    })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  return memberRecord || null
}
