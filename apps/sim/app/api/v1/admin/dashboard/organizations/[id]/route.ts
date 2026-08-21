import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getDashboardOrganization, renameDashboardOrganization } from '@/lib/admin/dashboard'
import {
  adminDashboardGetOrganizationContract,
  adminDashboardRenameOrganizationContract,
} from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardOrganizationAPI')

export const GET = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardGetOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      const organization = await getDashboardOrganization(parsed.data.params.id, parsed.data.query)
      return organization ? singleResponse(organization) : notFoundResponse('Organization')
    } catch (error) {
      logger.error('Failed to get dashboard organization', { error })
      return internalErrorResponse('Failed to get organization')
    }
  })
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardRenameOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      await renameDashboardOrganization(
        parsed.data.params.id,
        parsed.data.body.name,
        await getAdminAuditActor(request)
      )
      return singleResponse({ success: true as const })
    } catch (error) {
      return badRequestResponse(getErrorMessage(error, 'Failed to rename organization'))
    }
  })
)
