/**
 * GET /api/v1/admin/organizations/[id]/seats
 *
 * Get organization seat analytics including member activity.
 *
 * Response: AdminSingleResponse<AdminSeatAnalytics>
 */

import { createLogger } from '@sim/logger'
import { adminV1GetOrganizationSeatsContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { getOrganizationSeatAnalytics } from '@/lib/billing/validation/seat-management'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import type { AdminSeatAnalytics } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationSeatsAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetOrganizationSeatsContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

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
      }

      logger.info(`Admin API: Retrieved seat analytics for organization ${organizationId}`)

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to get organization seats', { error, organizationId })
      return internalErrorResponse('Failed to get organization seats')
    }
  })
)
