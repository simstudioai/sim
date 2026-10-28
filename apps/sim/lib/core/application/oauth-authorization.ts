import type { Principal } from '@sim/auth/principal'
import { type OAuthApiScope, oauthScopeSatisfies } from '@/lib/auth/oauth-provider'
import { delegatedApiScopes } from '@/lib/core/application/delegated-api-scopes'
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

/**
 * Enforces the client's grant independently of workspace membership and HTTP method: an OAuth
 * token's scopes, or those {@link withDelegatedApiScopes} grants a delegated principal. A
 * delegated principal may still reach an operation that declares no scope, which is internal.
 */
export function requireOAuthOperationScope(
  principal: Principal,
  operation: ApplicationOperation
): void {
  const granted = grantedApiScopes(principal)
  if (!granted) return
  if (principal.kind === 'oauth_access_token') {
    if (principal.expiresAt.getTime() <= Date.now()) throw new OAuthAccessTokenExpiredError()
    if (!operation.oauthScope) {
      throw new Error(`Operation ${operation.id} has no OAuth scope policy`)
    }
  }
  if (operation.oauthScope && !oauthScopeSatisfies(granted, operation.oauthScope)) {
    throw new InsufficientScopeError(operation.oauthScope)
  }
}

/**
 * Holds a change no scoped operation guards — an internal operation, or one authorized outside the
 * operation layer — to the current {@link withDelegatedApiScopes} grant. Outside a grant it allows.
 */
export function requireDelegatedApiScope(scope: OAuthApiScope): void {
  const granted = delegatedApiScopes()
  if (granted && !oauthScopeSatisfies(granted, scope)) throw new InsufficientScopeError(scope)
}

function grantedApiScopes(principal: Principal): readonly string[] | undefined {
  switch (principal.kind) {
    case 'oauth_access_token':
      return principal.scopes
    case 'delegated':
    case 'resource_delegated':
    case 'organization_delegated':
      return delegatedApiScopes()
    default:
      return undefined
  }
}
