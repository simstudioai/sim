import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq } from 'drizzle-orm'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import { syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { ensureUserInOrganizationTx } from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application/operation'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import {
  attachOwnedWorkspacesToOrganizationTx,
  joinAttachableWorkspaceIds,
  joinAttachSetUnchangedTx,
} from '@/lib/workspaces/organization-workspaces'

const logger = createLogger('AdminOrganizationMembersAPI')

const ADMIN_API_ACTOR = { type: 'system', name: 'Admin API' } as const

/**
 * The deployment operator's organization-membership administration, reached only through the
 * Admin API key. These are not the member-facing `organizations.members.*` operations: the operator
 * holds no role in the organization, may add any account to any team, and its writes skip the
 * invitation flow while running the same billing and workspace-sweep transaction.
 */
const adminOrganizationMemberOperations = {
  // permission-group-exempt: the caller is the deployment operator, not an organization member a permission group can govern
  list: defineOperation({
    id: 'admin.organizations.members.list',
    principalKinds: ['admin_api_key'],
    capability: 'none',
  }),
  // permission-group-exempt: the caller is the deployment operator, not an organization member a permission group can govern
  add: defineOperation({
    id: 'admin.organizations.members.add',
    principalKinds: ['admin_api_key'],
    capability: 'none',
  }),
} as const

/** The organization or the account an Admin API member request names does not exist. */
export class AdminMemberTargetNotFoundError extends OrchestrationError {
  constructor(readonly resource: 'Organization' | 'User') {
    super('not_found', `${resource} not found`)
    this.name = 'AdminMemberTargetNotFoundError'
  }
}

/** A member add the request's own state refuses; the message is the client-facing reason. */
export class AdminMemberAddRefusedError extends OrchestrationError {
  constructor(message: string) {
    super('validation', message)
    this.name = 'AdminMemberAddRefusedError'
  }
}

interface ListAdminOrganizationMembersInput {
  organizationId: string
  limit: number
  offset: number
}

interface AdminOrganizationMemberDetail {
  id: string
  userId: string
  organizationId: string
  role: string
  createdAt: Date
  userName: string
  userEmail: string
  currentPeriodCost: number
  currentUsageLimit: string | null
  billingBlocked: boolean
}

interface ListAdminOrganizationMembersResult {
  members: AdminOrganizationMemberDetail[]
  total: number
}

/** One page of an organization's members, oldest first, with each member's current-period usage. */
export const listAdminOrganizationMembers: OperationUseCase<
  typeof adminOrganizationMemberOperations.list,
  ListAdminOrganizationMembersInput,
  ListAdminOrganizationMembersResult
> = {
  operation: adminOrganizationMemberOperations.list,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, adminOrganizationMemberOperations.list)
    const { organizationId, limit, offset } = input

    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
    if (!orgData) throw new AdminMemberTargetNotFoundError('Organization')

    const [countResult, membersData] = await Promise.all([
      db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
      db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
          currentUsageLimit: userStats.currentUsageLimit,
          billingBlocked: userStats.billingBlocked,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(userStats, eq(member.userId, userStats.userId))
        .where(eq(member.organizationId, organizationId))
        .orderBy(member.createdAt)
        .limit(limit)
        .offset(offset),
    ])

    const { usageByUser } = await getOrganizationMemberUsageSnapshot(organizationId, {
      userIds: membersData.map((row) => row.userId),
    })

    const members = membersData.map((row) => ({
      ...row,
      currentPeriodCost: usageByUser.get(row.userId) ?? 0,
      billingBlocked: row.billingBlocked ?? false,
    }))
    logger.info('Admin API listed organization members', {
      organizationId,
      count: members.length,
    })
    return { members, total: countResult[0].count }
  },
}

interface AddAdminOrganizationMemberInput {
  organizationId: string
  userId: string
  role: 'admin' | 'member'
}

interface AdminMemberBillingActions {
  proUsageSnapshotted: boolean
  proCancelledAtPeriodEnd: boolean
}

interface AddAdminOrganizationMemberResult {
  action: 'created' | 'updated' | 'already_member'
  memberId: string
  role: string
  createdAt: Date
  userName: string
  userEmail: string
  billingActions: AdminMemberBillingActions
}

const NO_BILLING_ACTIONS: AdminMemberBillingActions = {
  proUsageSnapshotted: false,
  proCancelledAtPeriodEnd: false,
}

/**
 * Adds an account to an organization with the billing logic of invitation acceptance, or changes
 * the role of an account that is already a member of it.
 *
 * - Enterprise: the fixed `metadata.seats` cap is enforced before adding.
 * - Team: seats are elastic, so no cap is checked and the subscription is grown to the new member
 *   count afterwards.
 *
 * A Pro usage snapshot and subscription cancellation run as in the invitation flow, and every
 * workspace the new member owns follows them into the organization in the same transaction.
 */
export const addAdminOrganizationMember: OperationUseCase<
  typeof adminOrganizationMemberOperations.add,
  AddAdminOrganizationMemberInput,
  AddAdminOrganizationMemberResult
> = {
  operation: adminOrganizationMemberOperations.add,
  async execute({ principal, input, request }) {
    assertOperationPrincipal(principal, adminOrganizationMemberOperations.add)
    const { organizationId, userId, role } = input
    const operation = adminOrganizationMemberOperations.add

    const [orgData] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
    if (!orgData) throw new AdminMemberTargetNotFoundError('Organization')

    const [userData] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!userData) throw new AdminMemberTargetNotFoundError('User')

    /** A personal organization is retired when its owner is added, so only a team counts. */
    const [existingMember] = await db
      .select({
        id: member.id,
        role: member.role,
        createdAt: member.createdAt,
        organizationId: member.organizationId,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, userId), eq(organization.kind, 'team')))
      .limit(1)

    if (existingMember) {
      if (existingMember.organizationId !== organizationId) {
        throw new AdminMemberAddRefusedError(
          'User is already a member of another organization. Users can only belong to one organization at a time.'
        )
      }
      if (existingMember.role === 'owner') {
        throw new AdminMemberAddRefusedError(
          'Cannot change the owner role via this endpoint. Use POST /api/v1/admin/organizations/[id]/transfer-ownership instead.'
        )
      }
      if (existingMember.role === role) {
        return {
          action: 'already_member',
          memberId: existingMember.id,
          role: existingMember.role,
          createdAt: existingMember.createdAt,
          userName: userData.name,
          userEmail: userData.email,
          billingActions: NO_BILLING_ACTIONS,
        }
      }

      await db.update(member).set({ role }).where(eq(member.id, existingMember.id))
      logger.info('Admin API updated organization member role', {
        userId,
        organizationId,
        previousRole: existingMember.role,
        newRole: role,
      })
      recordProjectedUseCaseAuditEntries(operation, null, principal, request, [
        {
          action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          description: `Admin API changed organization member role to ${role}`,
          metadata: { targetUserId: userId, previousRole: existingMember.role, role },
        },
      ])
      return {
        action: 'updated',
        memberId: existingMember.id,
        role,
        createdAt: existingMember.createdAt,
        userName: userData.name,
        userEmail: userData.email,
        billingActions: NO_BILLING_ACTIONS,
      }
    }

    /**
     * Membership and the workspace sweep commit or roll back together: every workspace the new
     * member owns follows them into the org (collaborators stay external), and an attach failure
     * aborts the whole add instead of leaving a member whose workspaces escaped the sweep. Lock
     * order mirrors invitation acceptance: workspace advisory locks first, then the organization
     * lock inside ensureUserInOrganizationTx.
     */
    const organizationSubscription = isBillingEnabled
      ? await getOrganizationSubscription(organizationId)
      : null
    const organizationHasFixedSeats = isEnterprise(organizationSubscription?.plan)

    const result = await db.transaction(async (tx) => {
      /** The workspace that will hold their moved personal-organization chats stays out. */
      const ownedWorkspaceIds = await joinAttachableWorkspaceIds(tx, userId)
      if (ownedWorkspaceIds.length > 0) {
        await acquireInvitationMutationLocks(tx, {
          invitationIds: [],
          workspaceIds: ownedWorkspaceIds,
        })
      }

      /**
       * Only Enterprise has a seat cap to enforce. Team seats are elastic —
       * `reconcileOrganizationSeats` sets `subscription.seats` to exactly the member count, so
       * validating against it would compare N members to N seats and reject every add. Invitation
       * acceptance skips the check for the same reason; this path must agree or the two disagree
       * on whether a Team org has room.
       */
      const membership = await ensureUserInOrganizationTx(tx, {
        userId,
        organizationId,
        role,
        actor: ADMIN_API_ACTOR,
        skipBillingLogic: !isBillingEnabled,
        skipSeatValidation: isBillingEnabled && !organizationHasFixedSeats,
      })
      if (!membership.success || !membership.memberId || membership.alreadyMember) {
        return {
          membership,
          attachedWorkspaceIds: [],
          usageLimitUserIds: [],
          skippedSplitProjectWorkspaceIds: [],
        }
      }

      /**
       * ensureUserInOrganizationTx holds the user's billing-identity lock, which personal
       * workspace creation also takes — so re-reading the owned set here is race-free. A set that
       * changed since the pre-lock capture means a workspace escaped the advisory-lock plan: abort
       * the whole add (rolling back the membership) rather than committing a member whose
       * workspace dodged the sweep. Safe to retry immediately. The workspace the retirement moved
       * the chats into, possibly created by it, is neither compared nor attached.
       */
      const unchanged = await joinAttachSetUnchangedTx(tx, {
        userId,
        plannedWorkspaceIds: ownedWorkspaceIds,
        chatWorkspaceId: membership.retirement?.chatWorkspaceId ?? null,
      })
      if (!unchanged) {
        throw new AdminMemberAddRefusedError(
          "The user's workspaces changed while adding them — retry the add."
        )
      }

      if (ownedWorkspaceIds.length === 0) {
        return {
          membership,
          attachedWorkspaceIds: [],
          usageLimitUserIds: [],
          skippedSplitProjectWorkspaceIds: [],
        }
      }
      const attach = await attachOwnedWorkspacesToOrganizationTx(tx, {
        ownerUserId: userId,
        organizationId,
        workspaceIds: ownedWorkspaceIds,
        externalMemberPolicy: 'external-all',
        ownerMatch: 'owner',
        includeArchived: true,
        /** A collaborator's fork sharing a Project must not refuse the add. */
        skipSplitProjects: true,
        actor: ADMIN_API_ACTOR,
      })
      return {
        membership,
        attachedWorkspaceIds: attach.attachedWorkspaceIds,
        usageLimitUserIds: attach.usageLimitUserIds,
        skippedSplitProjectWorkspaceIds: attach.skippedSplitProjectWorkspaceIds,
      }
    })

    const { membership } = result
    if (!membership.success || !membership.memberId) {
      throw new AdminMemberAddRefusedError(membership.error || 'Failed to add member')
    }
    if (membership.alreadyMember) {
      throw new AdminMemberAddRefusedError('User is already a member of this organization')
    }

    /**
     * Team seats are billed per member, so a committed add has to grow the subscription —
     * acceptance does this post-commit and best-effort, and the drift sweep is the backstop if it
     * fails. Enterprise has a fixed allotment and is skipped inside the reconcile.
     */
    if (isBillingEnabled && !organizationHasFixedSeats) {
      try {
        await reconcileOrganizationSeats({ organizationId, reason: 'admin-member-added' })
      } catch (seatError) {
        logger.error('Failed to reconcile seats after admin member add', {
          userId,
          organizationId,
          error: seatError,
        })
      }
    }

    if (result.attachedWorkspaceIds.length > 0) {
      logger.info('Attached new member workspaces to organization', {
        userId,
        organizationId,
        attachedWorkspaceCount: result.attachedWorkspaceIds.length,
      })
    }
    for (const limitUserId of new Set(result.usageLimitUserIds)) {
      try {
        await syncUsageLimitsFromSubscription(limitUserId)
      } catch (syncError) {
        logger.error('Failed to sync usage limits after admin member add', {
          userId: limitUserId,
          organizationId,
          error: syncError,
        })
      }
    }

    logger.info('Admin API added organization member', {
      userId,
      organizationId,
      role,
      memberId: membership.memberId,
      billingActions: membership.billingActions,
      attachedWorkspaceCount: result.attachedWorkspaceIds.length,
    })
    recordProjectedUseCaseAuditEntries(operation, null, principal, request, [
      {
        action: AuditAction.ORG_MEMBER_ADDED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        description: `Admin API added member to organization as ${role}`,
        metadata: {
          targetUserId: userId,
          role,
          memberId: membership.memberId,
          attachedWorkspaceIds: result.attachedWorkspaceIds,
          skippedSplitProjectWorkspaceIds: result.skippedSplitProjectWorkspaceIds,
        },
      },
    ])

    return {
      action: 'created',
      memberId: membership.memberId,
      role,
      createdAt: new Date(),
      userName: userData.name,
      userEmail: userData.email,
      billingActions: {
        proUsageSnapshotted: membership.billingActions.proUsageSnapshotted,
        proCancelledAtPeriodEnd: membership.billingActions.proCancelledAtPeriodEnd,
      },
    }
  },
}
