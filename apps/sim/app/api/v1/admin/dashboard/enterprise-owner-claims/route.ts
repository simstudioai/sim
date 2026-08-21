import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  adminDashboardCreateEnterpriseOwnerClaimContract,
  adminDashboardListEnterpriseOwnerClaimsContract,
} from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  createEnterpriseOwnerClaim,
  getOpenEnterpriseOwnerClaimsPage,
} from '@/lib/billing/enterprise-owner-claim'
import { EnterpriseProvisioningError } from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseOwnerClaimsAPI')

export const GET = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardListEnterpriseOwnerClaimsContract,
      request,
      {},
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      const { limit, offset } = parsed.data.query
      const result = await getOpenEnterpriseOwnerClaimsPage({ limit, offset })
      return listResponse(result.data, {
        total: result.total,
        limit,
        offset,
        hasMore: offset + result.data.length < result.total,
      })
    } catch (error) {
      logger.error('Failed to list Enterprise owner claims', { error })
      return internalErrorResponse(getErrorMessage(error, 'Failed to list owner invitations'))
    }
  })
)

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(
      adminDashboardCreateEnterpriseOwnerClaimContract,
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
      const { usageLimitDollars, ...body } = parsed.data.body
      return singleResponse(
        await createEnterpriseOwnerClaim({
          ...body,
          usageLimitCredits:
            usageLimitDollars === undefined ? undefined : dollarsToCredits(usageLimitDollars),
          requestedByEmail: actor.email ?? 'admin-api',
          requestedByUserId: actor.id,
          requestedByName: actor.name,
        })
      )
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to create Enterprise owner claim', { error })
      return internalErrorResponse(getErrorMessage(error, 'Failed to invite the Enterprise owner'))
    }
  })
)
