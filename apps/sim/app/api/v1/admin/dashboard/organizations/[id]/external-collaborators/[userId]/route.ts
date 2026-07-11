import { getErrorMessage } from '@sim/utils/errors'
import { updateDashboardExternalCollaboratorUsageLimit } from '@/lib/admin/external-collaborators'
import { adminDashboardUpdateExternalCollaboratorLimitContract } from '@/lib/api/contracts/v1/admin/dashboard'
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

interface RouteParams {
  id: string
  userId: string
}

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardUpdateExternalCollaboratorLimitContract,
      request,
      context,
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    try {
      await updateDashboardExternalCollaboratorUsageLimit(
        parsed.data.params.id,
        parsed.data.params.userId,
        parsed.data.body.usageLimitDollars,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const })
    } catch (error) {
      return badRequestResponse(
        getErrorMessage(error, 'Failed to update external collaborator usage cap')
      )
    }
  })
)
