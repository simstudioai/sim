import { getErrorMessage } from '@sim/utils/errors'
import {
  removeDashboardOrganizationMember,
  updateDashboardOrganizationMember,
} from '@/lib/admin/dashboard'
import {
  adminDashboardRemoveMemberContract,
  adminDashboardUpdateMemberContract,
} from '@/lib/api/contracts/v1/admin/dashboard'
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

interface RouteParams {
  id: string
  memberId: string
}

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardUpdateMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      await updateDashboardOrganizationMember(
        parsed.data.params.id,
        parsed.data.params.memberId,
        parsed.data.body,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const })
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to update member'))
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardRemoveMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      await removeDashboardOrganizationMember(
        parsed.data.params.id,
        parsed.data.params.memberId,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const })
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to remove member'))
    }
  })
)
