import { getErrorMessage } from '@sim/utils/errors'
import { toDashboardProvisioning } from '@/lib/admin/dashboard'
import { adminDashboardRetryEnterpriseWorkspaceMoveContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import {
  EnterpriseProvisioningError,
  retryEnterpriseWorkspaceMove,
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
  moveId: string
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardRetryEnterpriseWorkspaceMoveContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        toDashboardProvisioning(
          await retryEnterpriseWorkspaceMove(
            parsed.data.params.id,
            parsed.data.params.moveId,
            await getAdminAuditActor(request)
          )
        )
      )
    } catch (error) {
      return badRequestResponse(
        error instanceof EnterpriseProvisioningError
          ? error.message
          : getErrorMessage(error, 'Failed to retry Enterprise workspace move')
      )
    }
  })
)
