import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, ne } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getOrganizationContract,
  updateOrganizationContract,
} from '@/lib/api/contracts/organization'
import { organizationRoleSchema } from '@/lib/api/contracts/primitives'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { getOrganization } from '@/lib/organizations/application/reads'

const logger = createLogger('OrganizationAPI')

export const GET = defineInternalJsonRoute({
  contract: getOrganizationContract,
  auth: internalSessionAuth,
  operation: organizationOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing organization metadata admission',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    includeSeats: query.include === 'seats',
  }),
  useCase: getOrganization,
  present: (result) => ({
    success: true,
    data: {
      id: result.id,
      name: result.name,
      slug: result.slug,
      logo: result.logo,
      metadata: result.metadata,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
      ...(result.seats ? { seats: result.seats } : {}),
      ...(result.seatAnalytics ? { seatAnalytics: result.seatAnalytics } : {}),
    },
    userRole: organizationRoleSchema.parse(result.role),
    hasAdminAccess: result.hasAdminAccess,
  }),
})

/**
 * PUT /api/organizations/[id]
 * Update organization settings (name, slug, logo)
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

      if (!isOrgAdminRole(memberEntry[0].role)) {
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
