import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  adminDashboardLinkAwsMarketplaceLicenseContract,
  adminDashboardListAwsMarketplaceLicensesContract,
} from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import {
  linkAwsMarketplaceLicenseAsAdmin,
  listUnlinkedAwsMarketplaceLicenses,
} from '@/lib/billing/aws-marketplace/application/admin'
import { isAwsMarketplaceEnabled } from '@/lib/billing/aws-marketplace/config'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminConflictResponse,
  adminInternalErrorResponse,
  adminInvalidJsonResponse,
  adminNotFoundResponse,
  adminValidationErrorResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminAwsMarketplaceLicensesAPI')

/** The Marketplace licenses no organization holds yet. */
export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    if (!isAwsMarketplaceEnabled()) return adminNotFoundResponse('AWS Marketplace')
    const parsed = await parseRequest(
      adminDashboardListAwsMarketplaceLicensesContract,
      request,
      {},
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      const { limit, offset } = parsed.data.query
      const { total, licenses } = await listUnlinkedAwsMarketplaceLicenses({ limit, offset })
      return listResponse(licenses, {
        total,
        limit,
        offset,
        hasMore: offset + licenses.length < total,
      })
    } catch (error) {
      logger.error('Failed to list AWS Marketplace licenses', { error })
      return adminInternalErrorResponse(getErrorMessage(error, 'Failed to list licenses'))
    }
  })
)

/** Links a Marketplace license to an organization once the team has provisioned it. */
export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    if (!isAwsMarketplaceEnabled()) return adminNotFoundResponse('AWS Marketplace')
    const parsed = await parseRequest(
      adminDashboardLinkAwsMarketplaceLicenseContract,
      request,
      {},
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response
    try {
      const actor = await getAdminAuditActor(request)
      return singleResponse(await linkAwsMarketplaceLicenseAsAdmin(parsed.data.body, actor))
    } catch (error) {
      const refusal = asOrchestrationError(error)
      if (refusal?.code === 'not_found') return adminNotFoundResponse(refusal.message)
      if (refusal?.code === 'conflict') return adminConflictResponse(refusal.message)
      logger.error('Failed to link an AWS Marketplace license', { error })
      return adminInternalErrorResponse(getErrorMessage(error, 'Failed to link the license'))
    }
  })
)
