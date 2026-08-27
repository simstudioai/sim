import { getErrorMessage } from '@sim/utils/errors'
import { requestDashboardSubscriptionCancellation } from '@/lib/admin/subscription-lifecycle'
import { adminDashboardCancelSubscriptionContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardCancelSubscriptionContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await requestDashboardSubscriptionCancellation({
          organizationId: parsed.data.params.id,
          ...parsed.data.body,
          actor: await getAdminAuditActor(request),
        })
      )
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Could not cancel subscription'))
    }
  })
)
