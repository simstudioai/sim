import { getErrorMessage } from '@sim/utils/errors'
import { retryAdminInvitationOperationJob } from '@/lib/admin/invitation-operation'
import { adminDashboardRetryInvitationOperationJobContract } from '@/lib/api/contracts/v1/admin/dashboard'
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
  jobId: string
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardRetryInvitationOperationJobContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await retryAdminInvitationOperationJob(
          parsed.data.params.id,
          parsed.data.params.operationId,
          parsed.data.params.jobId
        )
      )
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to retry invitation operation job'))
    }
  })
)
