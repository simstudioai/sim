import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getDashboardSubscriptionBillingActions } from '@/lib/admin/subscription-lifecycle'
import { adminDashboardBillingActionsContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminDashboardBillingActionsAPI')

export const GET = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminDashboardBillingActionsContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response
    try {
      return singleResponse(await getDashboardSubscriptionBillingActions(parsed.data.params.id))
    } catch (error) {
      logger.warn('Could not load organization billing actions', { error })
      return badRequestResponse(getErrorMessage(error, 'Could not load billing actions'))
    }
  })
)
