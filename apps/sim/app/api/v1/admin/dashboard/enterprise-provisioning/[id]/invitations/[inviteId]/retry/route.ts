import { getErrorMessage } from '@sim/utils/errors'
import { toDashboardProvisioning } from '@/lib/admin/dashboard'
import { adminDashboardRetryEnterpriseInvitationContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import {
  EnterpriseProvisioningError,
  retryEnterpriseInvitation,
} from '@/lib/billing/enterprise-provisioning'
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
  inviteId: string
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardRetryEnterpriseInvitationContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        toDashboardProvisioning(
          await retryEnterpriseInvitation(
            parsed.data.params.id,
            parsed.data.params.inviteId,
            await getAdminAuditActor(request)
          )
        )
      )
    } catch (error) {
      return badRequestResponse(
        error instanceof EnterpriseProvisioningError
          ? error.message
          : getErrorMessage(error, 'Failed to retry Enterprise invitation')
      )
    }
  })
)
