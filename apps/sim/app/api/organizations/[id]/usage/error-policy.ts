import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import {
  UsageWindowRangeInvertedError,
  UsageWindowRangeTooLargeError,
} from '@/lib/billing/core/usage-analytics'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'

/** Preserve internal organization-access refusals and classify invalid reporting windows. */
export const organizationUsageErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (
      error instanceof OrganizationMembershipNotFoundError ||
      (error instanceof ForbiddenOperationError &&
        error.detailCode === 'ORGANIZATION_ADMIN_REQUIRED')
    ) {
      return internalErrorResponse(403, {
        error: 'Organization admin or owner authority is required to read pooled usage',
      })
    }
    return error instanceof UsageWindowRangeTooLargeError ||
      error instanceof UsageWindowRangeInvertedError
      ? internalErrorResponse(400, { error: error.message })
      : null
  }
)
