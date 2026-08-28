/**
 * GET /api/v1/admin/organizations
 *
 * List all organizations with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminOrganization>
 *
 * POST /api/v1/admin/organizations
 *
 * Create a new organization.
 *
 * Body:
 *   - name: string - Organization name (required)
 *   - slug: string - Organization slug (optional, auto-generated from name if not provided)
 *   - ownerId: string - User ID of the organization owner (required)
 *
 * Response: AdminSingleResponse<AdminOrganization & { memberId: string }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db, dbReplica } from '@sim/db'
import { member, organization, organizationColumns, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { slugify } from '@sim/utils/string'
import { count, eq } from 'drizzle-orm'
import {
  adminV1CreateOrganizationContract,
  adminV1ListOrganizationsContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import {
  createOrganizationWithOwner,
  OrganizationSlugInvalidError,
  OrganizationSlugTakenError,
} from '@/lib/billing/organizations/create-organization'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { attachOwnedWorkspacesToOrganization } from '@/lib/workspaces/organization-workspaces'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminOrganization,
  createPaginationMeta,
  toAdminOrganization,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationsAPI')

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminV1ListOrganizationsContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { limit, offset } = parsed.data.query

    try {
      const [countResult, organizations] = await Promise.all([
        dbReplica.select({ total: count() }).from(organization),
        dbReplica
          .select({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            logo: organization.logo,
            orgUsageLimit: organization.orgUsageLimit,
            storageUsedBytes: organization.storageUsedBytes,
            createdAt: organization.createdAt,
            updatedAt: organization.updatedAt,
          })
          .from(organization)
          .orderBy(organization.name)
          .limit(limit)
          .offset(offset),
      ])

      const total = countResult[0].total
      const data: AdminOrganization[] = organizations.map(toAdminOrganization)
      const pagination = createPaginationMeta(total, limit, offset)

      logger.info(`Admin API: Listed ${data.length} organizations (total: ${total})`)

      return listResponse(data, pagination)
    } catch (error) {
      logger.error('Admin API: Failed to list organizations', { error })
      return internalErrorResponse('Failed to list organizations')
    }
  })
)

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminV1CreateOrganizationContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    try {
      const { name, ownerId, slug: requestedSlug } = parsed.data.body

      const [ownerData] = await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(eq(user.id, ownerId))
        .limit(1)

      if (!ownerData) {
        return notFoundResponse('Owner user')
      }

      const [existingMembership] = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, ownerId))
        .limit(1)

      if (existingMembership) {
        return badRequestResponse(
          'User is already a member of another organization. Users can only belong to one organization at a time.'
        )
      }

      const slug = requestedSlug?.trim() || slugify(name)

      const { organizationId, memberId } = await createOrganizationWithOwner({
        ownerUserId: ownerId,
        name,
        slug,
      })

      /**
       * Organization settings are reached only through a workspace the organization
       * owns, so an organization that owns none leaves its own admin with no route
       * to administer it. Attaching the owner's existing workspaces is what makes the
       * organization reachable, and matches what `POST /api/organizations` already
       * does — this path was the inconsistent one.
       *
       * An owner with no workspaces has nothing to attach and stays unreachable until
       * one exists. Creating a workspace only closes that gap once the organization
       * carries a usable Team/Enterprise plan; without one the creation policy still
       * resolves to a personal workspace.
       *
       * Attachment is a follow-on effect, not part of creating the organization, and
       * it is deliberately not folded into the creation transaction: it runs its own,
       * under a documented lock order (invitation scope, then organization, then
       * workspace rows) that exists to avoid deadlocking against invitation
       * acceptance. Re-deriving that ordering in a route is how a deadlock ships.
       *
       * So its failure must not be reported as a failure to create: the organization
       * is already committed, and answering 500 for state that exists left the retry
       * blocked by the existing-membership check above, with no way to reach the
       * organization at all. Log it and return the organization that was created —
       * attaching a workspace afterwards is a normal, repeatable operation.
       */
      let attachedWorkspaceIds: string[] = []
      try {
        ;({ attachedWorkspaceIds } = await attachOwnedWorkspacesToOrganization({
          ownerUserId: ownerId,
          organizationId,
          externalMemberPolicy: 'keep-external',
          includeArchived: true,
        }))
      } catch (attachError) {
        logger.error('Admin API: Created organization but could not attach its workspaces', {
          organizationId,
          ownerId,
          error: getErrorMessage(attachError),
        })
      }

      const [createdOrg] = await db
        .select(organizationColumns)
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      logger.info(`Admin API: Created organization ${organizationId}`, {
        name,
        slug,
        ownerId,
        memberId,
        attachedWorkspaceIds,
      })

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORGANIZATION_CREATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        resourceName: name,
        description: `Admin API created organization "${name}"`,
        metadata: { slug, ownerId, memberId },
        request,
      })

      return singleResponse({
        ...toAdminOrganization(createdOrg),
        memberId,
      })
    } catch (error) {
      if (error instanceof OrganizationSlugInvalidError) {
        return badRequestResponse(
          'Organization slug can only contain lowercase letters, numbers, hyphens, and underscores.'
        )
      }

      if (error instanceof OrganizationSlugTakenError) {
        return badRequestResponse('This slug is already taken')
      }

      logger.error('Admin API: Failed to create organization', { error })
      return internalErrorResponse('Failed to create organization')
    }
  })
)
