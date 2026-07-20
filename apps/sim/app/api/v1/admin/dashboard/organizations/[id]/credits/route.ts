import { getErrorMessage } from '@sim/utils/errors'
import { grantDashboardOrganizationBalance } from '@/lib/admin/dashboard'
import { adminDashboardGrantBalanceContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardGrantBalanceContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      const result = await grantDashboardOrganizationBalance(
        parsed.data.params.id,
        parsed.data.body.amountDollars,
        parsed.data.body.reason,
        parsed.data.body.operationId,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const, ...result })
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to grant prepaid balance'))
    }
  })
)
