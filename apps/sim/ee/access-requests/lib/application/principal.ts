import type { Principal } from '@sim/auth/principal'
import { requireAllowedOrganizationPrincipal } from '@/lib/core/application/organization-authorization'
import { requireAllowedWorkspacePrincipal } from '@/lib/core/application/workspace-authorization'
import type {
  AccessRequestOperation,
  AccessRequestPrincipal,
} from '@/ee/access-requests/lib/application/operations'

/**
 * Runs before the request scope is derived. Organization-delegated Chat only ever reaches review,
 * so it is checked against the organization policy; every other caller against the workspace one.
 */
export function requireAccessRequestPrincipal(
  principal: Principal,
  operation: AccessRequestOperation
): asserts principal is AccessRequestPrincipal {
  if (principal.kind === 'organization_delegated') {
    requireAllowedOrganizationPrincipal(principal, operation.organizationOperation)
  } else {
    requireAllowedWorkspacePrincipal(principal, operation)
  }
}
