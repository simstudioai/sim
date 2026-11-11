import { isReadOnlyApiKeyPrincipal, type Principal } from '@sim/auth/principal'
import { READ_ONLY_API_KEY_DENIED } from '@/lib/api-key/policy-messages'
import {
  OAUTH_API_READ_SCOPE,
  OAUTH_API_WRITE_SCOPE,
  OAUTH_SEARCH_READ_SCOPE,
  type OAuthApiScope,
  oauthScopeSatisfies,
} from '@/lib/auth/oauth-provider'
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

/**
 * A read-only API key reached an operation its `api:read` grant does not cover.
 * Not an {@link InsufficientScopeError}: an API key cannot step up to another
 * scope, so the refusal must not carry an OAuth `insufficient_scope` challenge.
 */
export class ReadOnlyApiKeyError extends ForbiddenOperationError {
  constructor() {
    super('READ_ONLY_API_KEY', READ_ONLY_API_KEY_DENIED)
    this.name = 'ReadOnlyApiKeyError'
  }
}

/** What a read-only API key is granted: the operations an `api:read` OAuth token reaches. */
const READ_ONLY_API_KEY_SCOPES = [OAUTH_API_READ_SCOPE] as const

export class OAuthAccessTokenExpiredError extends OrchestrationError {
  constructor() {
    super('unauthorized', 'OAuth access token has expired')
    this.name = 'OAuthAccessTokenExpiredError'
  }
}

/**
 * Enforces the client's grant independently of workspace membership and HTTP method: an OAuth
 * token's scopes, a read-only API key's `api:read`, or those {@link withDelegatedApiScopes}
 * grants a delegated principal. A delegated principal may still reach an operation that declares
 * no scope, which is internal; a read-only key may not, since nothing says that operation only
 * reads.
 */
export function requireOAuthOperationScope(
  principal: Principal,
  operation: ApplicationOperation
): void {
  const granted = grantedApiScopes(principal)
  if (!granted) return
  if (isReadOnlyApiKeyPrincipal(principal)) {
    if (!operation.oauthScope || !oauthScopeSatisfies(granted, operation.oauthScope)) {
      throw new ReadOnlyApiKeyError()
    }
    return
  }
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

const API_SCOPES: readonly OAuthApiScope[] = [
  OAUTH_API_READ_SCOPE,
  OAUTH_API_WRITE_SCOPE,
  OAUTH_SEARCH_READ_SCOPE,
]

/**
 * The API scopes a credential can reach, as `/api/v2/meta` reports them: each scope
 * {@link requireOAuthOperationScope} would let it through, so `api:write` reports the
 * `api:read` it implies and either reports `search:read`. A credential no grant bounds,
 * such as a write key, reaches every scope.
 */
export function credentialApiScopes(principal: Principal): OAuthApiScope[] {
  const granted = grantedApiScopes(principal)
  if (!granted) return [...API_SCOPES]
  return API_SCOPES.filter((scope) => oauthScopeSatisfies(granted, scope))
}

function grantedApiScopes(principal: Principal): readonly string[] | undefined {
  switch (principal.kind) {
    case 'oauth_access_token':
      return principal.scopes
    case 'personal_api_key':
    case 'workspace_api_key':
      return principal.access === 'read' ? READ_ONLY_API_KEY_SCOPES : undefined
    case 'delegated':
    case 'resource_delegated':
    case 'organization_delegated':
      return delegatedApiScopes()
    default:
      return undefined
  }
}
