import { getErrorMessage } from '@sim/utils/errors'
import { getAdminMemberOperation } from '@/lib/admin/member-operation'
import { adminDashboardMemberOperationContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const GET = withRouteHandler(
  withAdminAuthParams<{ id: string; operationId: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardMemberOperationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await getAdminMemberOperation(parsed.data.params.id, parsed.data.params.operationId)
      )
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to load member operation'))
    }
  })
)
