import { getErrorMessage } from '@sim/utils/errors'
import { revertDashboardEnterpriseToInvoicing } from '@/lib/admin/dashboard'
import { adminDashboardRevertToInvoicingContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminBadRequestResponse,
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardRevertToInvoicingContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      await revertDashboardEnterpriseToInvoicing(
        parsed.data.params.id,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const })
    } catch (error) {
      return adminBadRequestResponse(getErrorMessage(error, 'Failed to return to invoice payment'))
    }
  })
)
