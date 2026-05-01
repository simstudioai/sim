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
import { and, count, eq, inArray } from 'drizzle-orm'
import {
  adminV1GetOrganizationContract,
  adminV1UpdateOrganizationContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import {
  ensureOrganizationSlugAvailable,
  OrganizationSlugInvalidError,
  OrganizationSlugTakenError,
  validateOrganizationSlugOrThrow,
} from '@/lib/billing/organizations/create-organization'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
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

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

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
          .where(
            and(
              eq(subscription.referenceId, organizationId),
              inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
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
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1UpdateOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

    try {
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

      const validatedBody = parsed.data.body

      if (validatedBody.name !== undefined) {
        updateData.name = validatedBody.name
      }

      if (validatedBody.slug !== undefined) {
        const nextSlug = validatedBody.slug
        validateOrganizationSlugOrThrow(nextSlug)
        await ensureOrganizationSlugAvailable({
          slug: nextSlug,
          excludeOrganizationId: organizationId,
        })
        updateData.slug = nextSlug
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
      if (error instanceof OrganizationSlugInvalidError) {
        return badRequestResponse(
          'Organization slug can only contain lowercase letters, numbers, hyphens, and underscores.'
        )
      }

      if (error instanceof OrganizationSlugTakenError) {
        return badRequestResponse('This slug is already taken')
      }

      logger.error('Admin API: Failed to update organization', { error, organizationId })
      return internalErrorResponse('Failed to update organization')
    }
  })
)
