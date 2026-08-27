import { getErrorMessage } from '@sim/utils/errors'
import { createAdminInvitationOperation } from '@/lib/admin/invitation-operation'
import { adminDashboardInvitePeopleContract } from '@/lib/api/contracts/v1/admin/dashboard'
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
    const parsed = await parseRequest(adminDashboardInvitePeopleContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(
        await createAdminInvitationOperation({
          operationId: parsed.data.body.operationId,
          organizationId: parsed.data.params.id,
          emails: parsed.data.body.emails,
          workspaceIds: parsed.data.body.workspaceIds,
          role: parsed.data.body.role,
          permission: parsed.data.body.permission,
          actor: await getAdminAuditActor(request),
        })
      )
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to invite people'))
    }
  })
)
