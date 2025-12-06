/**
 * GET /api/v1/admin/organizations/[id]/seats
 *
 * Get organization seat analytics including member activity.
 *
 * Response: AdminSingleResponse<AdminSeatAnalytics>
 *
 * PATCH /api/v1/admin/organizations/[id]/seats
 *
 * Update organization seat count (for admin override of enterprise seats).
 *
 * Body:
 *   - seats: number - New seat count (for enterprise metadata.seats)
 *
 * Response: AdminSingleResponse<{ success: true, seats: number }>
 */

import { db } from '@sim/db'
import { organization, subscription } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { getOrganizationSeatAnalytics } from '@/lib/billing/validation/seat-management'
import { createLogger } from '@/lib/logs/console/logger'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminSeatAnalytics } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationSeatsAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  const { id: organizationId } = await context.params

  try {
    const analytics = await getOrganizationSeatAnalytics(organizationId)

    if (!analytics) {
      return notFoundResponse('Organization or subscription')
    }

    const data: AdminSeatAnalytics = {
      organizationId: analytics.organizationId,
      organizationName: analytics.organizationName,
      currentSeats: analytics.currentSeats,
      maxSeats: analytics.maxSeats,
      availableSeats: analytics.availableSeats,
      subscriptionPlan: analytics.subscriptionPlan,
      canAddSeats: analytics.canAddSeats,
      utilizationRate: analytics.utilizationRate,
      activeMembers: analytics.activeMembers,
      inactiveMembers: analytics.inactiveMembers,
      memberActivity: analytics.memberActivity.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        userEmail: m.userEmail,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        lastActive: m.lastActive?.toISOString() ?? null,
      })),
    }

    logger.info(`Admin API: Retrieved seat analytics for organization ${organizationId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get organization seats', { error, organizationId })
    return internalErrorResponse('Failed to get organization seats')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const body = await request.json()

    if (typeof body.seats !== 'number' || body.seats < 1 || !Number.isInteger(body.seats)) {
      return badRequestResponse('seats must be a positive integer')
    }

    const [orgData] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgData) {
      return notFoundResponse('Organization')
    }

    const [subData] = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
      .limit(1)

    if (!subData) {
      return notFoundResponse('Subscription')
    }

    if (subData.plan === 'enterprise') {
      const currentMetadata = (subData.metadata as Record<string, unknown>) || {}
      const newMetadata = {
        ...currentMetadata,
        seats: body.seats,
      }

      await db
        .update(subscription)
        .set({ metadata: newMetadata })
        .where(eq(subscription.id, subData.id))

      logger.info(`Admin API: Updated enterprise seats for organization ${organizationId}`, {
        seats: body.seats,
      })
    } else {
      await db
        .update(subscription)
        .set({ seats: body.seats })
        .where(eq(subscription.id, subData.id))

      logger.info(`Admin API: Updated team seats for organization ${organizationId}`, {
        seats: body.seats,
      })
    }

    return singleResponse({
      success: true,
      seats: body.seats,
      plan: subData.plan,
    })
  } catch (error) {
    logger.error('Admin API: Failed to update organization seats', { error, organizationId })
    return internalErrorResponse('Failed to update organization seats')
  }
})
