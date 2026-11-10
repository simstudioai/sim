import {
  fetchProvider,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
  TokenServiceAccountValidator,
} from '@/lib/credentials/token-service-accounts/server'

interface TokenCheckRequest {
  url: string
  method?: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

interface TokenCheck {
  /** Service name used as the default display name. */
  serviceLabel: string
  /**
   * A cheap documented read that succeeds only with a valid token — the same
   * host and auth scheme the service's tools use.
   */
  request: (fields: TokenServiceAccountFields) => TokenCheckRequest
}

/**
 * Validator for a service whose token is accepted or rejected by one
 * authenticated request: 2xx accepts, a non-transient 4xx rejects the token,
 * anything else is the provider being unavailable. Redirects are refused, so a
 * token is never forwarded to another host.
 */
export function tokenCheckValidator(check: TokenCheck): TokenServiceAccountValidator {
  return async (fields): Promise<TokenServiceAccountValidationResult> => {
    const { url, method = 'GET', headers, body } = check.request(fields)
    const response = await fetchProvider(
      url,
      { method, headers, body, redirect: 'error' },
      'verify'
    )
    await throwForProviderResponse(response, 'verify')
    await response.body?.cancel().catch(() => undefined)
    return { displayName: check.serviceLabel, principal: null, auditMetadata: {} }
  }
}
