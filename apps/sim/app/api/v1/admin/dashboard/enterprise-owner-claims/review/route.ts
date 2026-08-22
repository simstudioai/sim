import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { adminDashboardReviewEnterpriseOwnerClaimContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import { reviewEnterpriseOwnerClaim } from '@/lib/billing/enterprise-owner-claim'
import { EnterpriseProvisioningError } from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseOwnerClaimReviewAPI')

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardReviewEnterpriseOwnerClaimContract,
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
        await reviewEnterpriseOwnerClaim({
          ...body,
          usageLimitCredits:
            usageLimitDollars === undefined ? undefined : dollarsToCredits(usageLimitDollars),
          requestedByEmail: 'admin-review',
          requestedByUserId: null,
          requestedByName: 'Admin Panel',
        })
      )
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to review Enterprise owner claim', { error })
      return internalErrorResponse(
        getErrorMessage(error, 'Failed to review the Enterprise owner invitation')
      )
    }
  })
)
