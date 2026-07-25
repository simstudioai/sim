import { getErrorMessage } from '@sim/utils/errors'
import { getDashboardMemberTransferPreflight } from '@/lib/admin/dashboard'
import { adminDashboardMemberPreflightContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const GET = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardMemberPreflightContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await getDashboardMemberTransferPreflight(parsed.data.params.id, parsed.data.query.userId)
      )
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to prepare member transfer'))
    }
  })
)
