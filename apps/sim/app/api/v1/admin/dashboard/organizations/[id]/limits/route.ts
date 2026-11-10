import { getErrorMessage } from '@sim/utils/errors'
import { updateDashboardOrganizationLimits } from '@/lib/admin/dashboard'
import { adminDashboardUpdateLimitsContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminBadRequestResponse,
  adminConflictResponse,
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

export const PATCH = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardUpdateLimitsContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      await updateDashboardOrganizationLimits(
        parsed.data.params.id,
        parsed.data.body,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const })
    } catch (error) {
      const refusal = asOrchestrationError(error)
      if (refusal?.code === 'conflict') return adminConflictResponse(refusal.message)
      return adminBadRequestResponse(getErrorMessage(error, 'Failed to update limits'))
    }
  })
)
