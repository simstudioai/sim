/**
 * Organization Membership Management
 *
 * Shared helpers for adding and removing users from organizations.
 * Used by both regular routes and admin routes to ensure consistent business logic.
 */

import { db } from '@sim/db'
import {
  billingClaim,
  credential,
  credentialMember,
  invitation,
  member,
  organization,
  permissionGroupMember,
  permissions,
  subscription as subscriptionTable,
  usageLog,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { BILLING_CLAIM_PAYMENT_BLOCKING_STATUSES } from '@/lib/billing/claims/status'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import {
  doesOrganizationSubscriptionOwnMemberUsage,
  sqlIsPaid,
  sqlIsPro,
  sqlIsTeam,
} from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('OrganizationMembership')

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
  return db.transaction((tx) => restoreUserProSubscriptionTx(tx, userId))
}

async function restoreUserProSubscriptionTx(tx: DbOrTx, userId: string): Promise<RestoreProResult> {
  const result: RestoreProResult = {
    restored: false,
    usageRestored: false,
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
    .limit(1)

  if (!personalPro?.cancelAtPeriodEnd || !personalPro.stripeSubscriptionId) {
    return result
  }

  result.subscriptionId = personalPro.id

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
      proPeriodCostSnapshot: userStats.proPeriodCostSnapshot,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1)

  if (!stats) {
    return result
  }

  const snapshotNum = toNumber(toDecimal(stats.proPeriodCostSnapshot))

  if (snapshotNum <= 0) {
    return result
  }

  await tx
    .update(userStats)
    .set({
      proPeriodCostSnapshot: '0',
      proPeriodCostSnapshotAt: null,
    })
    .where(eq(userStats.userId, userId))

  result.usageRestored = true

  logger.info('Restored Pro usage snapshot', {
    userId,
    snapshotUsage: snapshotNum,
  })

  logger.info('Restored personal Pro subscription (DB committed, Stripe queued)', {
    userId,
    subscriptionId: personalPro.id,
    usageRestored: result.usageRestored,
  })

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
}

export interface RemoveMemberResult {
  success: boolean
  error?: string
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
  const [ownerMembership] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)

  const ownerId = ownerMembership?.userId
  if (!ownerId || ownerId === userId || workspaceIds.length === 0) return 0

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
    .returning({ id: workspace.id })

  if (reassignedWorkspaces.length === 0) return 0

  const now = new Date()
  await tx
    .update(permissions)
    .set({ permissionType: 'admin', updatedAt: now })
    .where(
      and(
        eq(permissions.userId, ownerId),
        eq(permissions.entityType, 'workspace'),
        inArray(
          permissions.entityId,
          reassignedWorkspaces.map((row) => row.id)
        )
      )
    )

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
    .onConflictDoNothing()

  return reassignedWorkspaces.length
}

async function revokeWorkspaceCredentialMembershipsTx({
  tx,
  workspaceIds,
  userId,
}: {
  tx: DbOrTx
  workspaceIds: string[]
  userId: string
}) {
  if (workspaceIds.length === 0) return 0

  const workspaceCredentialRows = await tx
    .select({
      credentialId: credential.id,
      workspaceId: credential.workspaceId,
      ownerId: workspace.ownerId,
    })
    .from(credential)
    .innerJoin(workspace, eq(credential.workspaceId, workspace.id))
    .where(inArray(credential.workspaceId, workspaceIds))

  if (workspaceCredentialRows.length === 0) return 0

  const credentialIds = workspaceCredentialRows.map((row) => row.credentialId)
  const ownerByCredentialId = new Map(
    workspaceCredentialRows.map((row) => [row.credentialId, row.ownerId])
  )

  const userAdminMemberships = await tx
    .select({ credentialId: credentialMember.credentialId })
    .from(credentialMember)
    .where(
      and(
        eq(credentialMember.userId, userId),
        eq(credentialMember.role, 'admin'),
        eq(credentialMember.status, 'active'),
        inArray(credentialMember.credentialId, credentialIds)
      )
    )

  for (const { credentialId } of userAdminMemberships) {
    const ownerId = ownerByCredentialId.get(credentialId)
    if (!ownerId || ownerId === userId) continue

    const otherAdmins = await tx
      .select({ id: credentialMember.id })
      .from(credentialMember)
      .where(
        and(
          eq(credentialMember.credentialId, credentialId),
          eq(credentialMember.role, 'admin'),
          eq(credentialMember.status, 'active'),
          ne(credentialMember.userId, userId)
        )
      )
      .limit(1)

    if (otherAdmins.length > 0) continue

    const now = new Date()
    const [existingOwnerMembership] = await tx
      .select({ id: credentialMember.id })
      .from(credentialMember)
      .where(
        and(eq(credentialMember.credentialId, credentialId), eq(credentialMember.userId, ownerId))
      )
      .limit(1)

    if (existingOwnerMembership) {
      await tx
        .update(credentialMember)
        .set({ role: 'admin', status: 'active', updatedAt: now })
        .where(eq(credentialMember.id, existingOwnerMembership.id))
    } else {
      await tx.insert(credentialMember).values({
        id: generateId(),
        credentialId,
        userId: ownerId,
        role: 'admin',
        status: 'active',
        joinedAt: now,
        invitedBy: ownerId,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  const revokedMemberships = await tx
    .update(credentialMember)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(
      and(
        eq(credentialMember.userId, userId),
        eq(credentialMember.status, 'active'),
        inArray(credentialMember.credentialId, credentialIds)
      )
    )
    .returning({ credentialId: credentialMember.credentialId })

  return revokedMemberships.length
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
 * Applies the billing side-effects of a user joining org-owned billing
 * inside an existing transaction:
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
    .limit(1)

  if (personalPro && !personalPro.cancelAtPeriodEnd) {
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
    const [membershipRow] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1)

    const [orgSub] = await tx
      .select({ plan: subscriptionTable.plan })
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, organizationId),
          inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
          sqlIsPaid(subscriptionTable.plan)!
        )
      )
      .limit(1)

    if (!orgSub || !doesOrganizationSubscriptionOwnMemberUsage(orgSub.plan, membershipRow?.role)) {
      return { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false }
    }

    return applyPaidOrgJoinBillingTx(tx, userId, organizationId)
  })
}

export async function handleOrganizationMemberRoleBillingTransition(params: {
  userId: string
  organizationId: string
  previousRole: 'admin' | 'member' | 'owner'
  nextRole: 'admin' | 'member' | 'owner'
}): Promise<void> {
  await db.transaction((tx) => applyOrganizationMemberRoleBillingTransitionTx(tx, params))
  await syncUsageLimitsFromSubscription(params.userId)
}

export async function updateOrganizationMemberRoleWithBilling(params: {
  userId: string
  organizationId: string
  previousRole: 'admin' | 'member' | 'owner'
  nextRole: 'admin' | 'member' | 'owner'
}): Promise<typeof member.$inferSelect | null> {
  const updatedMember = await db.transaction(async (tx) => {
    const [currentMember] = await tx
      .select()
      .from(member)
      .where(
        and(eq(member.userId, params.userId), eq(member.organizationId, params.organizationId))
      )
      .for('update')
      .limit(1)

    if (!currentMember) return null
    if (currentMember.role !== params.previousRole) {
      throw new Error('Organization member role changed before billing transition could complete')
    }

    await applyOrganizationMemberRoleBillingTransitionTx(tx, params)

    const [updated] = await tx
      .update(member)
      .set({ role: params.nextRole })
      .where(eq(member.id, currentMember.id))
      .returning()

    return updated ?? null
  })

  if (updatedMember) {
    await syncUsageLimitsFromSubscription(params.userId)
  }

  return updatedMember
}

async function applyOrganizationMemberRoleBillingTransitionTx(
  tx: DbOrTx,
  params: {
    userId: string
    organizationId: string
    previousRole: 'admin' | 'member' | 'owner'
    nextRole: 'admin' | 'member' | 'owner'
  }
): Promise<void> {
  const { userId, organizationId, previousRole, nextRole } = params
  if (previousRole === nextRole) return

  const [orgSub] = await tx
    .select({
      plan: subscriptionTable.plan,
      periodStart: subscriptionTable.periodStart,
      periodEnd: subscriptionTable.periodEnd,
    })
    .from(subscriptionTable)
    .where(
      and(
        eq(subscriptionTable.referenceId, organizationId),
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
        sqlIsPaid(subscriptionTable.plan)!
      )
    )
    .limit(1)

  if (!orgSub) {
    return
  }

  const previouslyOwned = doesOrganizationSubscriptionOwnMemberUsage(orgSub.plan, previousRole)
  const nowOwned = doesOrganizationSubscriptionOwnMemberUsage(orgSub.plan, nextRole)

  if (!previouslyOwned && nowOwned) {
    await attributeLegacyUsageForRoleOwnershipTransition({
      executor: tx,
      userId,
      organizationId,
      entityType: 'user',
      entityId: userId,
      periodStart: orgSub.periodStart,
      periodEnd: orgSub.periodEnd,
    })
    await applyPaidOrgJoinBillingTx(tx, userId, organizationId)
  } else if (previouslyOwned && !nowOwned) {
    await attributeLegacyUsageForRoleOwnershipTransition({
      executor: tx,
      userId,
      organizationId,
      entityType: 'organization',
      entityId: organizationId,
      periodStart: orgSub.periodStart,
      periodEnd: orgSub.periodEnd,
    })
    await restoreUserProSubscriptionTx(tx, userId)
    await unblockUserIfNoPersonalPaymentIssueTx(tx, userId)
  }
}

async function attributeLegacyUsageForRoleOwnershipTransition(params: {
  executor: DbOrTx
  userId: string
  organizationId: string
  entityType: 'user' | 'organization'
  entityId: string
  periodStart: Date | null
  periodEnd: Date | null
}): Promise<void> {
  if (!params.periodStart) return

  const [membershipRow] = await params.executor
    .select({ createdAt: member.createdAt })
    .from(member)
    .where(and(eq(member.userId, params.userId), eq(member.organizationId, params.organizationId)))
    .limit(1)

  if (!membershipRow) return

  const now = new Date()
  const periodStart =
    membershipRow.createdAt > params.periodStart ? membershipRow.createdAt : params.periodStart
  const periodEnd = params.periodEnd && params.periodEnd < now ? params.periodEnd : now
  if (periodEnd <= periodStart) return

  await params.executor.execute(sql`
    UPDATE ${usageLog}
    SET
      ${usageLog.billingEntityType} = ${params.entityType},
      ${usageLog.billingEntityId} = ${params.entityId}
    WHERE ${usageLog.userId} = ${params.userId}
      AND ${usageLog.billingEntityType} IS NULL
      AND ${usageLog.createdAt} >= ${periodStart}
      AND ${usageLog.createdAt} < ${periodEnd}
  `)
}

async function unblockUserIfNoPersonalPaymentIssue(userId: string): Promise<void> {
  await db.transaction((tx) => unblockUserIfNoPersonalPaymentIssueTx(tx, userId))
}

async function unblockUserIfNoPersonalPaymentIssueTx(tx: DbOrTx, userId: string): Promise<void> {
  const [pastDueSubscription] = await tx
    .select({ id: subscriptionTable.id })
    .from(subscriptionTable)
    .where(and(eq(subscriptionTable.referenceId, userId), eq(subscriptionTable.status, 'past_due')))
    .limit(1)
  if (pastDueSubscription) return

  const [unresolvedClaim] = await tx
    .select({ id: billingClaim.id })
    .from(billingClaim)
    .where(
      and(
        eq(billingClaim.entityType, 'user'),
        eq(billingClaim.entityId, userId),
        inArray(billingClaim.status, BILLING_CLAIM_PAYMENT_BLOCKING_STATUSES)
      )
    )
    .limit(1)
  if (unresolvedClaim) return

  await tx
    .update(userStats)
    .set({ billingBlocked: false, billingBlockedReason: null })
    .where(and(eq(userStats.userId, userId), eq(userStats.billingBlockedReason, 'payment_failed')))
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

    let memberId = ''

    await db.transaction(async (tx) => {
      memberId = generateId()
      await tx.insert(member).values({
        id: memberId,
        userId,
        organizationId,
        role,
        createdAt: new Date(),
      })

      if (skipBillingLogic) {
        return
      }

      const [orgSub] = await tx
        .select({ plan: subscriptionTable.plan })
        .from(subscriptionTable)
        .where(
          and(
            eq(subscriptionTable.referenceId, organizationId),
            inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
            sqlIsPaid(subscriptionTable.plan)!
          )
        )
        .limit(1)

      if (!orgSub || !doesOrganizationSubscriptionOwnMemberUsage(orgSub.plan, role)) {
        return
      }

      const joinBillingActions = await applyPaidOrgJoinBillingTx(tx, userId, organizationId)
      billingActions.proUsageSnapshotted = joinBillingActions.proUsageSnapshotted
      billingActions.proCancelledAtPeriodEnd = joinBillingActions.proCancelledAtPeriodEnd
    })

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
  const { userId, organizationId, memberId, skipBillingLogic = false } = params

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

    const {
      workspaceIdsToRevoke,
      usageCaptured,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
    } = await db.transaction(async (tx) => {
      const [membershipRow] = await tx
        .select({ createdAt: member.createdAt })
        .from(member)
        .where(and(eq(member.id, memberId), ne(member.role, 'owner')))
        .for('update')
        .limit(1)

      if (!membershipRow) {
        throw new Error(
          'Member could not be removed — they may have been promoted to owner concurrently'
        )
      }

      let capturedUsage = 0
      if (!skipBillingLogic) {
        const [orgSub] = await tx
          .select({
            plan: subscriptionTable.plan,
            periodStart: subscriptionTable.periodStart,
            periodEnd: subscriptionTable.periodEnd,
          })
          .from(subscriptionTable)
          .where(
            and(
              eq(subscriptionTable.referenceId, organizationId),
              inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
              sqlIsPaid(subscriptionTable.plan)!
            )
          )
          .limit(1)
        if (
          orgSub &&
          doesOrganizationSubscriptionOwnMemberUsage(orgSub.plan, existingMember.role)
        ) {
          const periodStart =
            orgSub.periodStart && orgSub.periodStart > membershipRow.createdAt
              ? orgSub.periodStart
              : membershipRow.createdAt
          const attributedRows = await tx.execute<{ cost: string }>(sql`
            UPDATE ${usageLog}
            SET
              ${usageLog.billingEntityType} = 'organization',
              ${usageLog.billingEntityId} = ${organizationId}
            WHERE ${usageLog.userId} = ${userId}
              AND ${usageLog.billingEntityType} IS NULL
              AND ${usageLog.createdAt} >= ${periodStart}
              AND ${orgSub.periodEnd ? sql`${usageLog.createdAt} < ${orgSub.periodEnd}` : sql`TRUE`}
            RETURNING ${usageLog.cost}::text AS cost
          `)
          capturedUsage = Array.from(attributedRows).reduce(
            (sum, row) => sum + toNumber(toDecimal(row.cost ?? '0')),
            0
          )
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

      const [personalSubscriptionPaymentIssue] = await tx
        .select({ id: subscriptionTable.id })
        .from(subscriptionTable)
        .where(
          and(eq(subscriptionTable.referenceId, userId), eq(subscriptionTable.status, 'past_due'))
        )
        .limit(1)
      const [personalOveragePaymentIssue] = await tx
        .select({ id: billingClaim.id })
        .from(billingClaim)
        .innerJoin(subscriptionTable, eq(subscriptionTable.id, billingClaim.subscriptionId))
        .where(
          and(
            eq(subscriptionTable.referenceId, userId),
            inArray(billingClaim.status, BILLING_CLAIM_PAYMENT_BLOCKING_STATUSES)
          )
        )
        .limit(1)

      if (!personalSubscriptionPaymentIssue && !personalOveragePaymentIssue) {
        await tx
          .update(userStats)
          .set({ billingBlocked: false, billingBlockedReason: null })
          .where(
            and(eq(userStats.userId, userId), eq(userStats.billingBlockedReason, 'payment_failed'))
          )
      }

      const [targetUser] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      const cancelledInvitations = targetUser?.email
        ? await tx
            .update(invitation)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(invitation.organizationId, organizationId),
                eq(invitation.status, 'pending'),
                sql`lower(${invitation.email}) = lower(${targetUser.email})`
              )
            )
            .returning({ id: invitation.id })
        : []

      const orgWorkspaces = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.organizationId, organizationId))

      if (orgWorkspaces.length === 0) {
        return {
          workspaceIdsToRevoke: [] as string[],
          usageCaptured: capturedUsage,
          credentialMembershipsRevoked: 0,
          pendingInvitationsCancelled: cancelledInvitations.length,
        }
      }

      const workspaceIds = orgWorkspaces.map((w) => w.id)

      await reassignOwnedOrganizationWorkspacesTx({
        tx,
        userId,
        organizationId,
        workspaceIds,
      })

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

      await tx
        .delete(permissionGroupMember)
        .where(
          and(
            eq(permissionGroupMember.userId, userId),
            inArray(permissionGroupMember.workspaceId, workspaceIds)
          )
        )

      const credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx({
        tx,
        workspaceIds,
        userId,
      })

      return {
        workspaceIdsToRevoke: deletedPerms.map((row) => row.entityId),
        usageCaptured: capturedUsage,
        credentialMembershipsRevoked,
        pendingInvitationsCancelled: cancelledInvitations.length,
      }
    })

    billingActions.usageCaptured = usageCaptured
    billingActions.workspaceAccessRevoked = workspaceIdsToRevoke.length
    billingActions.pendingInvitationsCancelled = pendingInvitationsCancelled

    if (usageCaptured > 0) {
      logger.info('Captured departed member usage', {
        organizationId,
        userId,
        usage: usageCaptured,
      })
    }

    logger.info('Removed member from organization', {
      organizationId,
      userId,
      memberId,
      workspaceAccessRevoked: workspaceIdsToRevoke.length,
      credentialMembershipsRevoked,
      pendingInvitationsCancelled,
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
                inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
                or(eq(subscriptionTable.plan, 'enterprise'), sqlIsTeam(subscriptionTable.plan)!)
              )
            )

          hasAnyPaidTeam = orgPaidSubs.length > 0
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

    return { success: true, billingActions }
  } catch (error) {
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
    } = await db.transaction(async (tx) => {
      const orgWorkspaces = await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.organizationId, organizationId))

      if (orgWorkspaces.length === 0) {
        return {
          workspaceAccessRevoked: 0,
          permissionGroupsRevoked: 0,
          credentialMembershipsRevoked: 0,
          pendingInvitationsCancelled: 0,
        }
      }

      const workspaceIds = orgWorkspaces.map((w) => w.id)
      const [targetUser] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)

      await reassignOwnedOrganizationWorkspacesTx({
        tx,
        userId,
        organizationId,
        workspaceIds,
      })

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

      const deletedPermissionGroups = await tx
        .delete(permissionGroupMember)
        .where(
          and(
            eq(permissionGroupMember.userId, userId),
            inArray(permissionGroupMember.workspaceId, workspaceIds)
          )
        )
        .returning({ id: permissionGroupMember.id })

      const credentialMembershipsRevoked = await revokeWorkspaceCredentialMembershipsTx({
        tx,
        workspaceIds,
        userId,
      })

      const cancelledInvitations = targetUser?.email
        ? await tx
            .update(invitation)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(
              and(
                eq(invitation.organizationId, organizationId),
                eq(invitation.status, 'pending'),
                eq(invitation.membershipIntent, 'external'),
                sql`lower(${invitation.email}) = lower(${targetUser.email})`
              )
            )
            .returning({ id: invitation.id })
        : []

      return {
        workspaceAccessRevoked: deletedPermissions.length,
        permissionGroupsRevoked: deletedPermissionGroups.length,
        credentialMembershipsRevoked,
        pendingInvitationsCancelled: cancelledInvitations.length,
      }
    })

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
      const lockedMembers = await tx
        .select({ id: member.id, role: member.role, userId: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            inArray(member.userId, [currentOwnerUserId, newOwnerUserId])
          )
        )
        .for('update')

      const currentOwnerMember = lockedMembers.find(
        (m) => m.userId === currentOwnerUserId && m.role === 'owner'
      )

      if (!currentOwnerMember) {
        throw new Error('Current user is not the owner of this organization')
      }

      const newOwnerMember = lockedMembers.find((m) => m.userId === newOwnerUserId)

      if (!newOwnerMember) {
        throw new Error('Target user is not a member of this organization')
      }

      await applyOrganizationMemberRoleBillingTransitionTx(tx, {
        userId: newOwnerUserId,
        organizationId,
        previousRole: newOwnerMember.role as 'admin' | 'member' | 'owner',
        nextRole: 'owner',
      })

      const demotedMembers = await tx
        .update(member)
        .set({ role: 'admin' })
        .where(eq(member.id, currentOwnerMember.id))
        .returning({ id: member.id })

      if (demotedMembers.length !== 1) {
        throw new Error('Current owner changed before ownership transfer could complete')
      }

      const promotedMembers = await tx
        .update(member)
        .set({ role: 'owner' })
        .where(eq(member.id, newOwnerMember.id))
        .returning({ id: member.id })

      if (promotedMembers.length !== 1) {
        throw new Error('Target owner changed before ownership transfer could complete')
      }

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
    await syncUsageLimitsFromSubscription(newOwnerUserId)

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
      error: error instanceof Error ? error.message : 'Failed to transfer ownership',
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
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
        or(eq(subscriptionTable.plan, 'enterprise'), sqlIsTeam(subscriptionTable.plan)!)
      )
    )
    .limit(1)

  if (!orgSub) {
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
  userId: string
): Promise<{ organizationId: string; role: string; memberId: string } | null> {
  const [memberRecord] = await db
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
