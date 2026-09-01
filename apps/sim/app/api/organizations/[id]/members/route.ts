import { db } from '@sim/db'
import { member, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, count, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  organizationMemberQuerySchema,
  organizationParamsSchema,
} from '@/lib/api/contracts/organization'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationMemberUsageSnapshot } from '@/lib/billing/core/organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  capabilityRefusal,
  isOrganizationCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'

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
      const { limit, offset } = queryResult.data
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

      /**
       * permission-group-enforced: organization.member_directory — an
       * organization-scoped read with no workspace for the funnel to authorize.
       *
       * Admins and owners are exempt. This response is the only source for the
       * team-management page and the seat-usage snapshot it renders, so
       * withholding it from an admin would take away the page they would use to
       * change the setting, and their seat management with it.
       */
      if (
        !hasAdminAccess &&
        (await isOrganizationCapabilityWithheld(organizationId, 'organization.member_directory'))
      ) {
        logger.warn('Organization member directory blocked by permission group', {
          organizationId,
          userId: session.user.id,
        })
        return NextResponse.json(
          { error: capabilityRefusal('organization.member_directory') },
          { status: 403 }
        )
      }

      // Get organization members
      const memberPageQuery = db
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
        .orderBy(user.name, user.id)
        .limit(limit)
        .offset(offset)

      const totalQuery = db
        .select({ value: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      // Include usage data if requested and user has admin access
      if (includeUsage && hasAdminAccess) {
        const [base, totalRows] = await Promise.all([
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
              usageLimitUpdatedAt: userStats.usageLimitUpdatedAt,
            })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .leftJoin(userStats, eq(user.id, userStats.userId))
            .where(eq(member.organizationId, organizationId))
            .orderBy(user.name, user.id)
            .limit(limit)
            .offset(offset),
          totalQuery,
        ])

        const { billingPeriod, usageByUser } = await getOrganizationMemberUsageSnapshot(
          organizationId,
          {
            userIds: base.map((row) => row.userId),
          }
        )
        const billingPeriodStart = billingPeriod?.start ?? null
        const billingPeriodEnd = billingPeriod?.end ?? null

        const membersWithUsage = base.map((row) => ({
          ...row,
          currentPeriodCost: (usageByUser.get(row.userId) ?? 0).toString(),
          billingPeriodStart,
          billingPeriodEnd,
        }))

        const total = totalRows[0]?.value ?? 0
        return NextResponse.json({
          success: true,
          data: membersWithUsage,
          total,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + membersWithUsage.length < total,
          },
          userRole,
          hasAdminAccess,
        })
      }

      const [members, totalRows] = await Promise.all([memberPageQuery, totalQuery])
      const total = totalRows[0]?.value ?? 0

      return NextResponse.json({
        success: true,
        data: members,
        total,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + members.length < total,
        },
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
