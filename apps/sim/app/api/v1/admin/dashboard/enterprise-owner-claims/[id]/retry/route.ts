import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { adminDashboardRetryEnterpriseOwnerClaimContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { retryEnterpriseOwnerClaim } from '@/lib/billing/enterprise-owner-claim'
import { EnterpriseProvisioningError } from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseOwnerClaimRetryAPI')

export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardRetryEnterpriseOwnerClaimContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(await retryEnterpriseOwnerClaim(parsed.data.params.id))
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to retry Enterprise owner invitation', { error })
      return internalErrorResponse(getErrorMessage(error, 'Failed to retry owner invitation'))
    }
  })
)
