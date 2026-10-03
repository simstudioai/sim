import { getErrorMessage } from '@sim/utils/errors'
import { adminDashboardEnterprisePreflightContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import {
  EnterpriseProvisioningError,
  getEnterpriseIssuancePreflight,
} from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardEnterprisePreflightContract,
      request,
      {},
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(await getEnterpriseIssuancePreflight(parsed.data.query))
    } catch (error) {
      return badRequestResponse(
        error instanceof EnterpriseProvisioningError
          ? error.message
          : getErrorMessage(error, 'Failed to prepare Enterprise issuance')
      )
    }
  })
)
