import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { ForbiddenOperationError } from '@/lib/core/application'
import type { UserAccountOperation } from '@/lib/users/application/operations'

/** Restricts self-service account operations to the authenticated account session. */
export function requireUserAccountPrincipal(
  principal: Principal,
  operation: UserAccountOperation
): asserts principal is SessionPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}; a first-party session is required`
    )
  }
}
