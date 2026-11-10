import { truncate } from '@sim/utils/string'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  fetchProvider,
  isTransientProviderStatus,
  TokenServiceAccountValidationError,
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
  /**
   * The vendor answers 401 to an unknown key and 403 to a valid key that lacks
   * this endpoint's scope, so the vendor's JSON 403 still proves the key
   * authenticated. Set only for vendors confirmed to reject unknown keys with 401.
   */
  forbiddenMeansScoped?: boolean
  /**
   * For a vendor that reports a rejected key inside a successful response (a
   * GraphQL `errors` array): returns whether the parsed body proves the key.
   */
  acceptsBody?: (body: unknown) => boolean
  /**
   * For a vendor that answers a rejected key with a server error (Fireflies
   * returns 500 with `auth_failed`): returns whether the error body names a bad
   * key, so the user is told the key is wrong rather than the vendor down.
   */
  rejectsKey?: (errorBody: unknown) => boolean
}

const MAX_CHECK_RESPONSE_BYTES = 64 * 1024

function readJsonBody(response: Response, serviceLabel: string): Promise<unknown> {
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_CHECK_RESPONSE_BYTES,
    label: `${serviceLabel} credential check`,
  })
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
    // A JSON 403 is the vendor's own answer; an HTML one is a firewall or CDN page.
    const scopedForbidden =
      check.forbiddenMeansScoped &&
      response.status === 403 &&
      (response.headers.get('content-type') ?? '').includes('application/json')
    if (check.rejectsKey && !response.ok && !scopedForbidden) {
      const errorBody = await readJsonBody(response, check.serviceLabel).catch(() => null)
      if (check.rejectsKey(errorBody)) {
        throw new TokenServiceAccountValidationError('invalid_credentials', 400, { step: 'verify' })
      }
      const callerError =
        response.status >= 400 &&
        response.status < 500 &&
        !isTransientProviderStatus(response.status)
      throw new TokenServiceAccountValidationError(
        callerError ? 'invalid_credentials' : 'provider_unavailable',
        response.status,
        { step: 'verify', body: truncate(JSON.stringify(errorBody) ?? '', 500) }
      )
    }
    if (!scopedForbidden) {
      await throwForProviderResponse(response, 'verify')
    }
    if (check.acceptsBody && response.ok) {
      let body: unknown
      try {
        body = await readJsonBody(response, check.serviceLabel)
      } catch {
        throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
          step: 'verify',
        })
      }
      if (!check.acceptsBody(body)) {
        throw new TokenServiceAccountValidationError('invalid_credentials', 400, { step: 'verify' })
      }
      return { displayName: check.serviceLabel, principal: null, auditMetadata: {} }
    }
    await response.body?.cancel().catch(() => undefined)
    return { displayName: check.serviceLabel, principal: null, auditMetadata: {} }
  }
}
