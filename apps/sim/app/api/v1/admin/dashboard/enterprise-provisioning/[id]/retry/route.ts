import { createLogger } from '@sim/logger'
import { toDashboardProvisioning } from '@/lib/admin/dashboard'
import { adminDashboardRetryEnterpriseContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import {
  EnterpriseProvisioningError,
  retryEnterpriseProvisioning,
} from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseProvisioningRetryAPI')

export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardRetryEnterpriseContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        toDashboardProvisioning(
          await retryEnterpriseProvisioning(
            parsed.data.params.id,
            await getAdminAuditActor(request)
          )
        )
      )
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to retry Enterprise provisioning', { error })
      return internalErrorResponse('Failed to retry Enterprise provisioning')
    }
  })
)
