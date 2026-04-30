import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, ne } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  getOrganizationSeatAnalytics,
  getOrganizationSeatInfo,
} from '@/lib/billing/validation/seat-management'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

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
      const hasAdminAccess = ['owner', 'admin'].includes(userRole)

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

/**
 * PUT /api/organizations/[id]
 * Update organization settings (name, slug, logo)
 * Note: For seat updates, use PUT /api/organizations/[id]/seats instead
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateOrganizationContract, request, context)
      if (!parsed.success) return parsed.response

      const { id: organizationId } = parsed.data.params
      const { name, slug, logo } = parsed.data.body

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

      if (!['owner', 'admin'].includes(memberEntry[0].role)) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      if (name !== undefined || slug !== undefined || logo !== undefined) {
        if (slug !== undefined) {
          const existingSlug = await db
            .select()
            .from(organization)
            .where(and(eq(organization.slug, slug), ne(organization.id, organizationId)))
            .limit(1)

          if (existingSlug.length > 0) {
            return NextResponse.json({ error: 'This slug is already taken' }, { status: 400 })
          }
        }

        const updateData: {
          updatedAt: Date
          name?: string
          slug?: string
          logo?: string | null
        } = { updatedAt: new Date() }
        if (name !== undefined) updateData.name = name
        if (slug !== undefined) updateData.slug = slug
        if (logo !== undefined) updateData.logo = logo

        const updatedOrg = await db
          .update(organization)
          .set(updateData)
          .where(eq(organization.id, organizationId))
          .returning()

        if (updatedOrg.length === 0) {
          return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        logger.info('Organization settings updated', {
          organizationId,
          updatedBy: session.user.id,
          changes: { name, slug, logo },
        })

        recordAudit({
          workspaceId: null,
          actorId: session.user.id,
          action: AuditAction.ORGANIZATION_UPDATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: organizationId,
          actorName: session.user.name ?? undefined,
          actorEmail: session.user.email ?? undefined,
          resourceName: updatedOrg[0].name,
          description: `Updated organization settings`,
          metadata: { changes: { name, slug, logo } },
          request,
        })

        return NextResponse.json({
          success: true,
          message: 'Organization updated successfully',
          data: {
            id: updatedOrg[0].id,
            name: updatedOrg[0].name,
            slug: updatedOrg[0].slug,
            logo: updatedOrg[0].logo,
            updatedAt: updatedOrg[0].updatedAt,
          },
        })
      }

      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 })
    } catch (error) {
      logger.error('Failed to update organization', {
        organizationId: (await context.params).id,
        error,
      })

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
