import { db, dbReplica } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  removeOrganizationMemberContract,
  updateOrganizationMemberRoleContract,
} from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  removeOrganizationMember,
  updateOrganizationMember,
} from '@/lib/organizations/application/members'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { captureServerEvent } from '@/lib/posthog/server'

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

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationMemberRoleContract,
  auth: internalSessionAuth,
  operation: organizationOperations.updateMember,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing organization member administration behavior.',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    userId: params.memberId,
    role: body.role,
  }),
  useCase: updateOrganizationMember,
  present: ({ member }, { principal }) => ({
    success: true,
    message: 'Member role updated successfully',
    data: { id: member.id, userId: member.userId, role: member.role, updatedBy: principal.userId },
  }),
  onSuccess: ({ principal, input }) => {
    captureServerEvent(
      principal.userId,
      'org_member_role_changed',
      { organization_id: input.organizationId, new_role: input.role },
      { groups: { organization: input.organizationId } }
    )
  },
})

export const DELETE = defineInternalJsonRoute({
  contract: removeOrganizationMemberContract,
  auth: internalSessionAuth,
  operation: organizationOperations.removeMember,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing organization member administration behavior.',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, userId: params.memberId }),
  useCase: removeOrganizationMember,
  present: (result) => ({
    success: true,
    message:
      result.membershipType === 'external'
        ? 'External member removed successfully'
        : result.wasSelfRemoval
          ? 'You have left the organization'
          : 'Member removed successfully',
    data: {
      removedMemberId: result.target.userId,
      removedBy: result.removedBy,
      removedAt: result.removedAt,
      ...(result.membershipType === 'external'
        ? {
            membershipType: 'external',
            workspaceAccessRevoked: result.removal.workspaceAccessRevoked,
            permissionGroupsRevoked: result.removal.permissionGroupsRevoked,
            credentialMembershipsRevoked: result.removal.credentialMembershipsRevoked,
            pendingInvitationsCancelled: result.removal.pendingInvitationsCancelled,
          }
        : { seatReduction: result.seatReduction }),
    },
  }),
  async onSuccess({ principal, input, result }) {
    if (result.wasSelfRemoval) {
      try {
        await setActiveOrganizationForCurrentSession(null)
      } catch (error) {
        logger.warn('Failed to clear active organization after self-removal', {
          organizationId: input.organizationId,
          error,
        })
      }
    }
    captureServerEvent(
      principal.userId,
      'org_member_removed',
      { organization_id: input.organizationId, is_self_removal: result.wasSelfRemoval },
      { groups: { organization: input.organizationId } }
    )
  },
})
