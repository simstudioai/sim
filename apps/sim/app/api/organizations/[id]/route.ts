import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import {
  getOrganizationSeatAnalytics,
  getOrganizationSeatInfo,
} from '@/lib/billing/validation/seat-management'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { organizationSettingsOperations } from '@/lib/organizations/application/operations'
import { updateOrganizationSettings } from '@/lib/organizations/application/settings'

const logger = createLogger('OrganizationAPI')

type OrganizationDetailsResponse = {
  success: true
  data: {
    id: string
    name: string
    slug: string | null
    logo: string | null
    metadata: unknown
    createdAt: Date
    updatedAt: Date
    seats?: NonNullable<Awaited<ReturnType<typeof getOrganizationSeatInfo>>>
    seatAnalytics?: NonNullable<Awaited<ReturnType<typeof getOrganizationSeatAnalytics>>>
  }
  userRole: string
  hasAdminAccess: boolean
}

/**
 * GET /api/organizations/[id]
 * Get organization details including settings and seat information
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params
      const url = new URL(request.url)
      const includeSeats = url.searchParams.get('include') === 'seats'

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

      const organizationEntry = await db
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (organizationEntry.length === 0) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      const userRole = memberEntry[0].role
      const hasAdminAccess = isOrgAdminRole(userRole)

      const response: OrganizationDetailsResponse = {
        success: true,
        data: {
          id: organizationEntry[0].id,
          name: organizationEntry[0].name,
          slug: organizationEntry[0].slug,
          logo: organizationEntry[0].logo,
          metadata: organizationEntry[0].metadata,
          createdAt: organizationEntry[0].createdAt,
          updatedAt: organizationEntry[0].updatedAt,
        },
        userRole,
        hasAdminAccess,
      }

      if (includeSeats) {
        const seatInfo = await getOrganizationSeatInfo(organizationId)
        if (seatInfo) {
          response.data.seats = seatInfo
        }

        if (hasAdminAccess) {
          const analytics = await getOrganizationSeatAnalytics(organizationId)
          if (analytics) {
            response.data.seatAnalytics = analytics
          }
        }
      }

      return NextResponse.json(response)
    } catch (error) {
      logger.error('Failed to get organization', {
        organizationId: (await params).id,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationContract,
  auth: internalSessionAuth,
  operation: organizationSettingsOperations.update,
  rateLimit: internalRateLimits.none({ reason: 'Authenticated organization administrator update' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, patch: body }),
  useCase: updateOrganizationSettings,
  present: (data) => ({
    success: true,
    message: 'Organization updated successfully',
    data: { ...data },
  }),
})
