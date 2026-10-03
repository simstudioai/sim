import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { adminDashboardEnterpriseReviewContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  EnterpriseProvisioningError,
  reviewEnterpriseProvisioning,
} from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseProvisioningReviewAPI')

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardEnterpriseReviewContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response
    try {
      const { usageLimitDollars, ...body } = parsed.data.body
      return singleResponse(
        await reviewEnterpriseProvisioning({
          ...body,
          usageLimitCredits:
            usageLimitDollars === undefined ? undefined : dollarsToCredits(usageLimitDollars),
        })
      )
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to review Enterprise provisioning', { error })
      return internalErrorResponse(getErrorMessage(error, 'Failed to review Enterprise plan'))
    }
  })
)
