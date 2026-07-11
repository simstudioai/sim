import { getErrorMessage } from '@sim/utils/errors'
import { addDashboardOrganizationMember } from '@/lib/admin/dashboard'
import { adminDashboardAddMemberContract } from '@/lib/api/contracts/v1/admin/dashboard'
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
    const parsed = await parseRequest(adminDashboardAddMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      const memberId = await addDashboardOrganizationMember(
        parsed.data.params.id,
        parsed.data.body,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const, memberId })
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to add member'))
    }
  })
)
