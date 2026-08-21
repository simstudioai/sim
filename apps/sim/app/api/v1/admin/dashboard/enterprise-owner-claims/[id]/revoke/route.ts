import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { adminDashboardRevokeEnterpriseOwnerClaimContract } from '@/lib/api/contracts/v1/admin/dashboard'
import { parseRequest } from '@/lib/api/server'
import { revokeEnterpriseOwnerClaim } from '@/lib/billing/enterprise-owner-claim'
import { EnterpriseProvisioningError } from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAdminAuditActor } from '@/app/api/v1/admin/dashboard/actor'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminEnterpriseOwnerClaimRevokeAPI')

export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(
      adminDashboardRevokeEnterpriseOwnerClaimContract,
      request,
      context,
      { validationErrorResponse: adminValidationErrorResponse }
    )
    if (!parsed.success) return parsed.response
    try {
      const actor = await getAdminAuditActor(request)
      return singleResponse(
        await revokeEnterpriseOwnerClaim(parsed.data.params.id, {
          id: actor.id,
          name: actor.name,
          email: actor.email,
        })
      )
    } catch (error) {
      if (error instanceof EnterpriseProvisioningError) return badRequestResponse(error.message)
      logger.error('Failed to revoke Enterprise owner invitation', { error })
      return internalErrorResponse(getErrorMessage(error, 'Failed to revoke owner invitation'))
    }
  })
)
