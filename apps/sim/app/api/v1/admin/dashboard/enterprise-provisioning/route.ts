import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toDashboardProvisioning } from '@/lib/admin/dashboard'
import { adminDashboardIssueEnterpriseContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  EnterpriseProvisioningError,
  issueEnterpriseProvisioning,
} from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseProvisioningAPI')

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardIssueEnterpriseContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response
    try {
      const actor = await getAdminAuditActor(request)
      const { includedMonthlyDollars, usageLimitDollars, ...body } = parsed.data.body
      return singleResponse(
        toDashboardProvisioning(
          await issueEnterpriseProvisioning({
            ...body,
            includedMonthlyCredits: dollarsToCredits(includedMonthlyDollars),
            usageLimitCredits:
              usageLimitDollars === undefined ? undefined : dollarsToCredits(usageLimitDollars),
            requestedByEmail: actor.email ?? 'admin-api',
            requestedByUserId: actor.id,
          })
        )
      )
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to enqueue Enterprise provisioning', { error })
      return internalErrorResponse(getErrorMessage(error, 'Failed to issue Enterprise plan'))
    }
  })
)
