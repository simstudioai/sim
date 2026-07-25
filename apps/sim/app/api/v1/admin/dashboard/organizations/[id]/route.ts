import { createLogger } from '@sim/logger'
import { getDashboardOrganization } from '@/lib/admin/dashboard'
import { adminDashboardGetOrganizationContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
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
      const organization = await getDashboardOrganization(parsed.data.params.id)
      return organization ? singleResponse(organization) : notFoundResponse('Organization')
    } catch (error) {
      logger.error('Failed to get dashboard organization', { error })
      return internalErrorResponse('Failed to get organization')
    }
  })
)
