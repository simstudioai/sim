import { getErrorMessage } from '@sim/utils/errors'
import { retryAdminMemberFollowUpJob } from '@/lib/admin/member-operation'
import { adminDashboardRetryMemberFollowUpJobContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
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
      adminDashboardRetryMemberFollowUpJobContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await retryAdminMemberFollowUpJob(
          parsed.data.params.id,
          parsed.data.params.operationId,
          parsed.data.params.jobId,
          await getAdminAuditActor(request)
        )
      )
    } catch (error) {
      return badRequestResponse(
        getErrorMessage(error, 'Could not retry member-operation follow-up job')
      )
    }
  })
)
