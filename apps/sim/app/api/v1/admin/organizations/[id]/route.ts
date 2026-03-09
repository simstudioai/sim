/**
 * GET /api/v1/admin/organizations/[id]
 *
 * Get organization details including member count and subscription.
 *
 * Response: AdminSingleResponse<AdminOrganizationDetail>
 *
 * PATCH /api/v1/admin/organizations/[id]
 *
 * Update organization details.
 *
 * Body:
 *   - name?: string - Organization name
 *   - slug?: string - Organization slug
 *
 * Response: AdminSingleResponse<AdminOrganization>
 */

import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminOrganizationDetail,
  toAdminOrganization,
  toAdminSubscription,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const [orgData] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [memberCountResult, subscriptionData] = await Promise.all([
      db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
      db
        .select()
        .from(subscription)
        .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
        .limit(1),
    ])

    const data: AdminOrganizationDetail = {
      ...toAdminOrganization(orgData),
      memberCount: memberCountResult[0].count,
      subscription: subscriptionData[0] ? toAdminSubscription(subscriptionData[0]) : null,
    }

    logger.info(`Admin API: Retrieved organization ${organizationId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get organization', { error, organizationId })
    return internalErrorResponse('Failed to get organization')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const body = await request.json()

    const [existing] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!existing) {
      return notFoundResponse('Organization')
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return badRequestResponse('name must be a non-empty string')
      }
      updateData.name = body.name.trim()
    }

    if (body.slug !== undefined) {
      if (typeof body.slug !== 'string' || body.slug.trim().length === 0) {
        return badRequestResponse('slug must be a non-empty string')
      }
      updateData.slug = body.slug.trim()
    }

    if (Object.keys(updateData).length === 1) {
      return badRequestResponse(
        'No valid fields to update. Use /billing endpoint for orgUsageLimit.'
      )
    }

    const [updated] = await db
      .update(organization)
      .set(updateData)
      .where(eq(organization.id, organizationId))
      .returning()

    logger.info(`Admin API: Updated organization ${organizationId}`, {
      fields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
    })

    return singleResponse(toAdminOrganization(updated))
  } catch (error) {
    logger.error('Admin API: Failed to update organization', { error, organizationId })
    return internalErrorResponse('Failed to update organization')
  }
})
