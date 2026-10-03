import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'

export const internalMemberUsageLimitErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) =>
    error instanceof OrganizationMembershipNotFoundError ||
    (error instanceof ForbiddenOperationError && error.detailCode === 'ORGANIZATION_ADMIN_REQUIRED')
      ? internalErrorResponse(403, { error: 'Forbidden - Admin access required' })
      : null
)
