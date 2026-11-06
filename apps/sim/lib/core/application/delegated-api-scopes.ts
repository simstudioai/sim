import { AsyncLocalStorage } from 'node:async_hooks'
import type { OAuthApiScope } from '@/lib/auth/oauth-provider'

const grantedScopes = new AsyncLocalStorage<readonly OAuthApiScope[]>()

/**
 * Runs `execute` with every delegated principal it authorizes holding only `scopes`, the way an
 * OAuth token's grant bounds its user: `requireOAuthOperationScope` refuses an operation whose
 * declared scope they do not satisfy, whatever role the principal's subject holds.
 */
export function withDelegatedApiScopes<T>(scopes: readonly OAuthApiScope[], execute: () => T): T {
  return grantedScopes.run(Object.freeze([...scopes]), execute)
}

/** The scopes the current invocation grants its delegated principals, or none when unbounded. */
export function delegatedApiScopes(): readonly OAuthApiScope[] | undefined {
  return grantedScopes.getStore()
}
