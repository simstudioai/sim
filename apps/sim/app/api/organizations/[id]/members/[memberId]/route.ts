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
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { setActiveOrganizationForCurrentSession } from '@/lib/auth/active-organization'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import {
  removeOrganizationMember,
  removeOrganizationMemberOperation,
} from '@/lib/organizations/application/member-removal'
import {
  updateOrganizationMemberRole,
  updateOrganizationMemberRoleOperation,
} from '@/lib/organizations/application/member-role'

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
export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationMemberRoleContract,
  auth: internalSessionAuth,
  operation: updateOrganizationMemberRoleOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing session-authenticated role update policy',
  }),
  errorPolicy: {
    project(error) {
      if (error instanceof ForbiddenOperationError)
        return { status: 403, body: { error: error.message, details: { code: error.detailCode } } }
      if (
        error instanceof OrchestrationError &&
        error.code === 'not_found' &&
        error.message === 'Organization not found'
      )
        return { status: 403, body: { error: 'Forbidden - Not a member of this organization' } }
      if (error instanceof OrchestrationError && error.code === 'forbidden')
        return { status: 403, body: { error: 'Forbidden - Admin access required' } }
      if (isRetryableTransactionError(error))
        return { status: 409, body: { error: 'The organization is busy; retry in a moment' } }
      return internalOrchestrationErrorPolicy.project(error)
    },
  },
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    userId: params.memberId,
    role: body.role,
  }),
  useCase: updateOrganizationMemberRole,
  present: (data) => ({
    success: true,
    message: 'Member role updated successfully',
    data: { ...data },
  }),
})

/**
 * DELETE /api/organizations/[id]/members/[memberId]
 * Remove member from organization
 */
export const DELETE = defineInternalJsonRoute({
  contract: removeOrganizationMemberContract,
  auth: internalSessionAuth,
  operation: removeOrganizationMemberOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing session-authenticated member removal policy',
  }),
  errorPolicy: {
    project(error) {
      if (
        error instanceof OrchestrationError &&
        error.code === 'not_found' &&
        error.message === 'Organization not found'
      )
        return { status: 403, body: { error: 'Forbidden - Not a member of this organization' } }
      return internalOrchestrationErrorPolicy.project(error)
    },
  },
  mapInput: ({ params }) => ({ organizationId: params.id, userId: params.memberId }),
  useCase: removeOrganizationMember,
  present: (result) => ({ ...result, data: { ...result.data } }),
  async onSuccess({ principal, input }) {
    if (principal.userId !== input.userId) return
    try {
      await setActiveOrganizationForCurrentSession(null)
    } catch (error) {
      logger.warn('Failed to clear active organization after self-removal', {
        userId: principal.userId,
        organizationId: input.organizationId,
        error,
      })
    }
  },
})
