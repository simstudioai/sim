import { getErrorMessage } from '@sim/utils/errors'
import { getAdminInvitationOperation } from '@/lib/admin/invitation-operation'
import { adminDashboardGetInvitationOperationContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

interface RouteParams {
  id: string
  operationId: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardGetInvitationOperationContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await getAdminInvitationOperation(parsed.data.params.id, parsed.data.params.operationId)
      )
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to load invitation operation'))
    }
  })
)
