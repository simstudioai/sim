import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, dbReplica } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationMemberRoleContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import {
  acquireOrganizationUserMutationLocks,
  removeExternalUserFromOrganizationWorkspaces,
  removeUserFromOrganization,
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR,
} from '@/lib/billing/organizations/membership'
import { reconcileOrganizationSeats } from '@/lib/billing/organizations/seats'
import { ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import { changeMemberRoleTx } from '@/lib/organizations/members/lifecycle'
import { captureServerEvent } from '@/lib/posthog/server'
import { assertMembershipNotScimManaged } from '@/ee/scim/lib/managed-membership'

const logger = createLogger('OrganizationMemberAPI')

/**
 * GET /api/organizations/[id]/members/[memberId]
 * Get individual organization member details
 */
export const GET = withRouteHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; memberId: string }> }
  ) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId, memberId } = await params
      const url = new URL(request.url)
      const includeUsage = url.searchParams.get('include') === 'usage'

      const userMember = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (userMember.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const userRole = userMember[0].role
      const hasAdminAccess = isOrgAdminRole(userRole)

      const memberQuery = db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
        .limit(1)

      const memberEntry = await memberQuery

      if (memberEntry.length === 0) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }

      const canViewDetails = hasAdminAccess || session.user.id === memberId

      if (!canViewDetails) {
        return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
      }

      let memberData = memberEntry[0]

      if (includeUsage && hasAdminAccess) {
        const usageData = await db
          .select({
            currentUsageLimit: userStats.currentUsageLimit,
            usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
            lastPeriodCost: userStats.lastPeriodCost,
          })
          .from(userStats)
          .where(eq(userStats.userId, memberId))
          .limit(1)

        if (usageData.length > 0) {
          const { billingPeriod, usageByUser } = await getOrganizationMemberUsageSnapshot(
            organizationId,
            {
              executor: dbReplica,
              userIds: [memberId],
            }
          )
          const memberLedger = usageByUser.get(memberId) ?? 0
          memberData = {
            ...memberData,
            usage: {
              ...usageData[0],
              currentPeriodCost: memberLedger.toString(),
              billingPeriodStart: billingPeriod?.start ?? null,
              billingPeriodEnd: billingPeriod?.end ?? null,
            },
          } as typeof memberData & {
            usage: (typeof usageData)[0] & {
              billingPeriodStart: Date | null
              billingPeriodEnd: Date | null
            }
          }
        }
      }

      return NextResponse.json({
        success: true,
        data: memberData,
        userRole,
        hasAdminAccess,
      })
    } catch (error) {
      logger.error('Failed to get organization member', {
        organizationId: (await params).id,
        memberId: (await params).memberId,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/organizations/[id]/members/[memberId]
 * Update organization member role
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateOrganizationMemberRoleContract, request, context)
      if (!parsed.success) return parsed.response

      const { id: organizationId, memberId } = parsed.data.params
      const { role } = parsed.data.body

      const userMember = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (userMember.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      if (!isOrgAdminRole(userMember[0].role)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      const targetMember = await db
        .select({
          id: member.id,
          role: member.role,
          userId: member.userId,
          email: user.email,
          name: user.name,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, memberId)))
        .limit(1)

      if (targetMember.length === 0) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }

      if (targetMember[0].role === 'owner') {
        return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 })
      }

      if (role === 'owner') {
        return NextResponse.json(
          {
            error:
              'Ownership transfer is not supported via this endpoint. Use POST /organizations/[id]/transfer-ownership instead.',
          },
          { status: 400 }
        )
      }

      /**
       * The member is re-read under the organization's mutation lock, so a
       * concurrent promotion to owner — or a directory provisioning this very
       * member — cannot slip between the checks and the write. When the
       * organization has made its identity provider the source of truth, a role
       * set here is reverted by the next sync; refusing says so.
       */
      const roleChange = await db.transaction(async (tx) => {
        await acquireOrganizationUserMutationLocks(tx, {
          userId: memberId,
          organizationIds: [organizationId],
        })
        await assertMembershipNotScimManaged({ organizationId, userId: memberId, executor: tx })
        return changeMemberRoleTx(tx, { organizationId, userId: memberId, role })
      })

      /**
       * The audit row and analytics event fire whether or not the role actually
       * moved, exactly as this route did before the write went through the
       * shared primitive. Callers assert on those side effects.
       */
      logger.info('Organization member role updated', {
        organizationId,
        memberId,
        newRole: role,
        updatedBy: session.user.id,
      })

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORG_MEMBER_ROLE_CHANGED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Changed role for member ${memberId} to ${role}`,
        metadata: {
          targetUserId: memberId,
          targetEmail: targetMember[0].email ?? undefined,
          targetName: targetMember[0].name ?? undefined,
          changes: [{ field: 'role', from: targetMember[0].role, to: role }],
        },
        request,
      })

      captureServerEvent(
        session.user.id,
        'org_member_role_changed',
        { organization_id: organizationId, new_role: role },
        { groups: { organization: organizationId } }
      )

      return NextResponse.json({
        success: true,
        message: 'Member role updated successfully',
        data: {
          id: targetMember[0].id,
          userId: targetMember[0].userId,
          role: roleChange.changed ? roleChange.to : roleChange.role,
          updatedBy: session.user.id,
        },
      })
    } catch (error) {
      if (error instanceof ForbiddenOperationError) {
        return NextResponse.json(
          { error: error.message, details: { code: error.detailCode } },
          { status: 403 }
        )
      }
      if (error instanceof OrchestrationError) {
        return NextResponse.json(
          { error: error.message },
          { status: statusForOrchestrationError(error.code) }
        )
      }
      /** The role change now serializes on the organization lock; a timeout is "retry", not a fault. */
      if (isRetryableTransactionError(error)) {
        return NextResponse.json(
          { error: 'The organization is busy; retry in a moment' },
          { status: 409 }
        )
      }

      logger.error('Failed to update organization member role', {
        organizationId: (await context.params).id,
        memberId: (await context.params).memberId,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * DELETE /api/organizations/[id]/members/[memberId]
 * Remove member from organization
 */
export const DELETE = withRouteHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; memberId: string }> }
  ) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId, memberId: targetUserId } = await params

      const userMember = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (userMember.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const canRemoveMembers =
        isOrgAdminRole(userMember[0].role) || session.user.id === targetUserId

      if (!canRemoveMembers) {
        return NextResponse.json({ error: 'Forbidden - Insufficient permissions' }, { status: 403 })
      }

      const targetMember = await db
        .select({ id: member.id, role: member.role, email: user.email, name: user.name })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, targetUserId)))
        .limit(1)

      if (targetMember.length === 0) {
        const [targetUser] = await db
          .select({ id: user.id, email: user.email, name: user.name })
          .from(user)
          .where(eq(user.id, targetUserId))
          .limit(1)

        if (!targetUser) {
          return NextResponse.json({ error: 'Member not found' }, { status: 404 })
        }

        const externalResult = await removeExternalUserFromOrganizationWorkspaces({
          userId: targetUserId,
          organizationId,
        })

        if (!externalResult.success) {
          const error = externalResult.error || 'External workspace member not found'
          const status =
            error === 'External workspace member not found'
              ? 404
              : error === 'User is an organization member'
                ? 409
                : error === WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR
                  ? 400
                  : 500

          return NextResponse.json({ error }, { status })
        }

        logger.info('External workspace member removed from organization workspaces', {
          organizationId,
          removedMemberId: targetUserId,
          removedBy: session.user.id,
          workspaceAccessRevoked: externalResult.workspaceAccessRevoked,
          permissionGroupsRevoked: externalResult.permissionGroupsRevoked,
          credentialMembershipsRevoked: externalResult.credentialMembershipsRevoked,
          pendingInvitationsCancelled: externalResult.pendingInvitationsCancelled,
        })

        recordAudit({
          workspaceId: null,
          actorId: session.user.id,
          action: AuditAction.ORG_MEMBER_REMOVED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          actorName: session.user.name ?? undefined,
          actorEmail: session.user.email ?? undefined,
          description: `Removed external workspace member ${targetUserId} from organization`,
          metadata: {
            targetUserId,
            targetEmail: targetUser.email ?? undefined,
            targetName: targetUser.name ?? undefined,
            membershipType: 'external',
            workspaceAccessRevoked: externalResult.workspaceAccessRevoked,
            permissionGroupsRevoked: externalResult.permissionGroupsRevoked,
            credentialMembershipsRevoked: externalResult.credentialMembershipsRevoked,
            pendingInvitationsCancelled: externalResult.pendingInvitationsCancelled,
          },
          request,
        })

        captureServerEvent(
          session.user.id,
          'org_member_removed',
          { organization_id: organizationId, is_self_removal: session.user.id === targetUserId },
          { groups: { organization: organizationId } }
        )

        return NextResponse.json({
          success: true,
          message: 'External member removed successfully',
          data: {
            removedMemberId: targetUserId,
            removedBy: session.user.id,
            removedAt: new Date().toISOString(),
            membershipType: 'external',
            workspaceAccessRevoked: externalResult.workspaceAccessRevoked,
            permissionGroupsRevoked: externalResult.permissionGroupsRevoked,
            credentialMembershipsRevoked: externalResult.credentialMembershipsRevoked,
            pendingInvitationsCancelled: externalResult.pendingInvitationsCancelled,
          },
        })
      }

      const result = await removeUserFromOrganization({
        userId: targetUserId,
        organizationId,
        memberId: targetMember[0].id,
        spareSessionToken: session.session.token,
      })

      if (!result.success) {
        if (result.error === 'Cannot remove organization owner') {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        if (result.error === 'Member not found') {
          return NextResponse.json({ error: result.error }, { status: 404 })
        }
        if (result.error === WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        return NextResponse.json({ error: result.error }, { status: 500 })
      }

      let seatReduction: Awaited<ReturnType<typeof reconcileOrganizationSeats>> | null = null
      try {
        seatReduction = await reconcileOrganizationSeats({
          organizationId,
          reason: 'member-removed',
          actorId: session.user.id,
        })
      } catch (seatError) {
        logger.error('Failed to reduce seats after member removal', {
          organizationId,
          removedMemberId: targetUserId,
          removedBy: session.user.id,
          error: seatError,
        })
        seatReduction = {
          changed: false,
          reason: 'Failed to reduce seats after member removal',
        }
      }

      if (session.user.id === targetUserId) {
        try {
          await setActiveOrganizationForCurrentSession(null)
        } catch (clearError) {
          logger.warn('Failed to clear active organization after self-removal', {
            userId: session.user.id,
            organizationId,
            error: clearError,
          })
        }
      }

      logger.info('Organization member removed', {
        organizationId,
        removedMemberId: targetUserId,
        removedBy: session.user.id,
        wasSelfRemoval: session.user.id === targetUserId,
        billingActions: result.billingActions,
        seatReduction,
      })

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORG_MEMBER_REMOVED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description:
          session.user.id === targetUserId
            ? 'Left the organization'
            : `Removed member ${targetUserId} from organization`,
        metadata: {
          targetUserId,
          targetEmail: targetMember[0].email ?? undefined,
          targetName: targetMember[0].name ?? undefined,
          wasSelfRemoval: session.user.id === targetUserId,
          seatReduction,
        },
        request,
      })

      captureServerEvent(
        session.user.id,
        'org_member_removed',
        { organization_id: organizationId, is_self_removal: session.user.id === targetUserId },
        { groups: { organization: organizationId } }
      )

      return NextResponse.json({
        success: true,
        message:
          session.user.id === targetUserId
            ? 'You have left the organization'
            : 'Member removed successfully',
        data: {
          removedMemberId: targetUserId,
          removedBy: session.user.id,
          removedAt: new Date().toISOString(),
          seatReduction,
        },
      })
    } catch (error) {
      logger.error('Failed to remove organization member', {
        organizationId: (await params).id,
        memberId: (await params).memberId,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
