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
   * The vendor answers 403 to a valid key that lacks this endpoint's scope, so
   * the vendor's JSON 403 still proves the key authenticated. A vendor that
   * also answers an unknown key with 403 must set {@link rejectsKey} to tell
   * the two apart.
   */
  forbiddenMeansScoped?: boolean
  /**
   * For a vendor that reports a rejected key inside a successful response (a
   * GraphQL `errors` array): returns whether the parsed body proves the key.
   */
  acceptsBody?: (body: unknown) => boolean
  /**
   * For a vendor whose error status alone doesn't say the key is bad (Fireflies
   * returns 500 with `auth_failed`; Brex returns its scope-error 403 for an
   * unknown key): returns whether the error body names a bad key. Checked
   * before {@link forbiddenMeansScoped} accepts a 403.
   */
  rejectsKey?: (errorBody: unknown) => boolean
  /**
   * For a vendor that answers a valid but restricted key with an error naming
   * the missing permission (Resend's `restricted_api_key` 401): returns whether
   * the error body proves the key authenticated. Checked after
   * {@link rejectsKey}.
   */
  provesKey?: (errorBody: unknown) => boolean
}

const MAX_CHECK_RESPONSE_BYTES = 64 * 1024

/** Reads a credential check's JSON response, capped so a hostile body can't exhaust memory. */
export function readJsonBody(response: Response, serviceLabel: string): Promise<unknown> {
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
  const accepted: TokenServiceAccountValidationResult = {
    displayName: check.serviceLabel,
    principal: null,
    auditMetadata: {},
  }
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
    if ((check.rejectsKey || check.provesKey) && !response.ok) {
      const unreadable = Symbol('unreadable')
      const errorBody = await readJsonBody(response, check.serviceLabel).catch(() => unreadable)
      if (errorBody !== unreadable && check.rejectsKey?.(errorBody)) {
        throw new TokenServiceAccountValidationError('invalid_credentials', 400, { step: 'verify' })
      }
      if (errorBody !== unreadable && check.provesKey?.(errorBody)) return accepted
      if (scopedForbidden) {
        // Only a body that was read and doesn't name a bad key proves the token.
        if (errorBody === unreadable) {
          throw new TokenServiceAccountValidationError('provider_unavailable', response.status, {
            step: 'verify',
            reason: 'unreadable 403 body',
          })
        }
        return accepted
      }
      const callerError =
        response.status >= 400 &&
        response.status < 500 &&
        !isTransientProviderStatus(response.status)
      throw new TokenServiceAccountValidationError(
        callerError ? 'invalid_credentials' : 'provider_unavailable',
        response.status,
        {
          step: 'verify',
          body: errorBody === unreadable ? '' : truncate(JSON.stringify(errorBody) ?? '', 500),
        }
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
      return accepted
    }
    await response.body?.cancel().catch(() => undefined)
    return accepted
  }
}
