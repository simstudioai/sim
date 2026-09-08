import type { Principal } from '@sim/auth/principal'
import { type OAuthApiScope, oauthScopeSatisfies } from '@/lib/auth/oauth-provider'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export class InsufficientScopeError extends ForbiddenOperationError {
  constructor(readonly requiredScope: OAuthApiScope) {
    super('INSUFFICIENT_SCOPE', `This operation requires the ${requiredScope} scope`)
    this.name = 'InsufficientScopeError'
  }
}

export class OAuthAccessTokenExpiredError extends OrchestrationError {
  constructor() {
    super('unauthorized', 'OAuth access token has expired')
    this.name = 'OAuthAccessTokenExpiredError'
  }
}

/** Enforces the client's grant independently of workspace membership and HTTP method. */
export function requireOAuthOperationScope(
  principal: Principal,
  operation: ApplicationOperation
): void {
  if (principal.kind !== 'oauth_access_token') return
  if (principal.expiresAt.getTime() <= Date.now()) throw new OAuthAccessTokenExpiredError()
  if (!operation.oauthScope) {
    throw new Error(`Operation ${operation.id} has no OAuth scope policy`)
  }
  if (!oauthScopeSatisfies(principal.scopes, operation.oauthScope)) {
    throw new InsufficientScopeError(operation.oauthScope)
  }
}
