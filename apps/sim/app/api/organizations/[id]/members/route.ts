import { db } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  organizationMemberQuerySchema,
  organizationParamsSchema,
} from '@/lib/api/contracts/organization'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationMembersAPI')

/**
 * GET /api/organizations/[id]/members
 * Get organization members with optional usage data
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const paramsResult = organizationParamsSchema.safeParse(await params)
      if (!paramsResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
          { status: 400 }
        )
      }

      const { id: organizationId } = paramsResult.data
      const queryResult = organizationMemberQuerySchema.safeParse(
        Object.fromEntries(request.nextUrl.searchParams.entries())
      )
      if (!queryResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(queryResult.error, 'Invalid query parameters') },
          { status: 400 }
        )
      }
      const includeUsage = queryResult.data.include === 'usage'

      // Verify user has access to this organization
      const memberEntry = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (memberEntry.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const userRole = memberEntry[0].role
      const hasAdminAccess = isOrgAdminRole(userRole)

      // Get organization members
      const query = db
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
        .where(eq(member.organizationId, organizationId))

      // Include usage data if requested and user has admin access
      if (includeUsage && hasAdminAccess) {
        const base = await db
          .select({
            id: member.id,
            userId: member.userId,
            organizationId: member.organizationId,
            role: member.role,
            createdAt: member.createdAt,
            userName: user.name,
            userEmail: user.email,
            currentPeriodCost: userStats.currentPeriodCost,
            currentUsageLimit: userStats.currentUsageLimit,
            usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .leftJoin(userStats, eq(user.id, userStats.userId))
          .where(eq(member.organizationId, organizationId))

        const { billingPeriod, includeLegacyBaseline, usageByUser } =
          await getOrganizationMemberUsageSnapshot(organizationId, {
            userIds: base.length <= 1_000 ? base.map((row) => row.userId) : undefined,
          })
        const billingPeriodStart = billingPeriod?.start ?? null
        const billingPeriodEnd = billingPeriod?.end ?? null

        const membersWithUsage = base.map((row) => ({
          ...row,
          currentPeriodCost: (
            (includeLegacyBaseline ? Number(row.currentPeriodCost ?? 0) : 0) +
            (usageByUser.get(row.userId) ?? 0)
          ).toString(),
          billingPeriodStart,
          billingPeriodEnd,
        }))

        return NextResponse.json({
          success: true,
          data: membersWithUsage,
          total: membersWithUsage.length,
          userRole,
          hasAdminAccess,
        })
      }

      const members = await query

      return NextResponse.json({
        success: true,
        data: members,
        total: members.length,
        userRole,
        hasAdminAccess,
      })
    } catch (error) {
      logger.error('Failed to get organization members', {
        organizationId: (await params).id,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
