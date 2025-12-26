/**
 * GET /api/v1/admin/organizations/[id]/seats
 *
 * Get organization seat analytics including member activity.
 *
 * Response: AdminSingleResponse<AdminSeatAnalytics>
 */

import { createLogger } from '@sim/logger'
import { getOrganizationSeatAnalytics } from '@/lib/billing/validation/seat-management'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
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
