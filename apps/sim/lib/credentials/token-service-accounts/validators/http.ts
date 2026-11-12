import { truncate } from '@sim/utils/string'
import { EgressRefusedError } from '@/lib/core/network/transport.server'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  fetchProvider,
  isHostNotFound,
  isVendorJsonForbidden,
  type ProviderResponse,
  providerFailureCode,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
  TokenServiceAccountValidator,
} from '@/lib/credentials/token-service-accounts/server'
import { credibleTokenExpiry } from '@/lib/credentials/vendor-token-expiry'

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
   * For a credential whose domain is part of the connection (a host, instance
   * URL, or region): normalizes what was typed into exactly the form the tools
   * use, throwing for anything they couldn't safely use. The result is what
   * {@link request} sees and what the credential stores, so runs reach only the
   * verified host.
   */
  domain?: (fields: TokenServiceAccountFields) => string
  /**
   * For a credential whose account id is part of the connection (an org slug,
   * account SID): returns it trimmed, throwing for a value that could steer the
   * request's path or host. Returns `undefined` for a sign-in mode that has no
   * account id (a ServiceNow OAuth client has no username).
   */
  workspaceId?: (fields: TokenServiceAccountFields) => string | undefined
  /**
   * The domain a credential takes when none is given (its descriptor field's `defaultValue`). A
   * credential on it keeps the bare service name credentials saved before the field existed have,
   * and its host failing to resolve is the vendor being unavailable rather than the user's typo.
   */
  defaultDomain?: string
  /**
   * The domain picks one of the vendor's own region hosts from a fixed list, never a host the user
   * typed, so one failing to resolve is the vendor being unavailable rather than the user's typo.
   */
  domainIsVendorRegion?: boolean
  /**
   * The request goes to a host the user chose (self-hosted or white-label), so
   * it runs through the same SSRF-guarded egress profile as the tools instead
   * of a plain fetch.
   */
  egress?: Extract<EgressProfile, 'configuredEndpoint' | 'selfHostedService'>
  /** The vendor echoes the token in its error body, so that body never reaches logs or error details. */
  errorBodyEchoesToken?: boolean
  /**
   * A cheap documented read that succeeds only with a valid token — the same
   * host and auth scheme the service's tools use. `fields` carries the
   * normalized domain and account id.
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
   * GraphQL `errors` array): returns whether the parsed body proves the key, or
   * a display name read from it (a GitLab token's name) when it does.
   */
  acceptsBody?: (body: unknown) => boolean | { displayName: string }
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
  /**
   * For a vendor that states when the verified token stops working: reads that moment from the
   * accepted response, whose `body` is the parsed JSON when {@link acceptsBody} read it. Returns
   * `undefined` when the vendor states no expiry or one that cannot be read; the token is still
   * accepted either way.
   */
  expiresAt?: (accepted: {
    headers: ProviderResponse['headers']
    body: unknown
  }) => Date | undefined
}

/** The expiry a check states for an accepted token, when it is credible. */
function credibleExpiry(
  check: TokenCheck,
  accepted: { headers: ProviderResponse['headers']; body: unknown }
): Date | undefined {
  return credibleTokenExpiry(check.expiresAt?.(accepted))
}

/** `accepted` with the expiry the check states, when there is a credible one. */
function withExpiry(
  accepted: TokenServiceAccountValidationResult,
  expiresAt: Date | undefined
): TokenServiceAccountValidationResult {
  return expiresAt ? { ...accepted, expiresAt } : accepted
}

const MAX_CHECK_RESPONSE_BYTES = 64 * 1024
/** The guarded fetch refuses a larger declared body outright; JSON reads stay capped at {@link MAX_CHECK_RESPONSE_BYTES}. */
const MAX_EGRESS_RESPONSE_BYTES = 1024 * 1024

/** Reads a credential check's JSON response, capped so a hostile body can't exhaust memory. */
export function readJsonBody(response: ProviderResponse, serviceLabel: string): Promise<unknown> {
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_CHECK_RESPONSE_BYTES,
    label: `${serviceLabel} credential check`,
  })
}

/** A domain that must be one of a fixed set (a region or regional host), compared case-insensitively. */
export function allowedDomain(allowed: { has(value: string): boolean }) {
  return ({ domain }: TokenServiceAccountFields): string => {
    const value = (domain ?? '').trim().toLowerCase()
    if (!allowed.has(value)) throw new Error('unknown region')
    return value
  }
}

/** Runs `normalize` on a typed connection field, rejecting what it refuses as the user's input. */
function normalizedField(
  normalize: ((fields: TokenServiceAccountFields) => string | undefined) | undefined,
  fields: TokenServiceAccountFields,
  field: 'domain' | 'account id'
): string | undefined {
  if (!normalize) return undefined
  try {
    return normalize(fields)
  } catch {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'verify',
      reason: `invalid ${field}`,
    })
  }
}

const hostNotAllowed = () =>
  new TokenServiceAccountValidationError('host_not_allowed', 400, {
    step: 'verify',
    reason: 'host not allowed',
  })

/**
 * Sends a check through the guarded egress profile. A host the policy refuses
 * (a private address, or plain http where https is required) is the user's
 * input, so it fails as `host_not_allowed` rather than `provider_unavailable`,
 * which renders as a retryable 503. A host that doesn't exist is `site_not_found`.
 */
async function sendThroughEgress(
  profile: NonNullable<TokenCheck['egress']>,
  { url, method = 'GET', headers, body }: TokenCheckRequest
): Promise<ProviderResponse> {
  // The transport applies the stricter every-address rule itself when it routes through an
  // environment proxy; its refusal is classified below, so a gateway route is not pre-judged.
  const validation = await validateUrlWithDNS(url, 'url', profile, { logDetails: false })
  if (!validation.isValid) {
    if (validation.refusal !== 'dns') throw hostNotAllowed()
    const notFound = isHostNotFound(validation.cause)
    throw new TokenServiceAccountValidationError(
      notFound ? 'site_not_found' : 'provider_unavailable',
      notFound ? 400 : 502,
      { step: 'verify', reason: notFound ? 'host does not resolve' : 'host lookup failed' }
    )
  }
  try {
    return await secureFetchWithPinnedIP(url, validation.resolvedIP, {
      profile,
      method,
      headers,
      body,
      timeout: 10_000,
      maxRedirects: 0,
      maxResponseBytes: MAX_EGRESS_RESPONSE_BYTES,
      logUrlValidationDetails: false,
    })
  } catch (error) {
    // The proxy route judges the host again; its answer may have changed since the check above.
    if (error instanceof EgressRefusedError) throw hostNotAllowed()
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'verify',
      reason: 'host unreachable',
    })
  }
}

/**
 * Validator for a service whose token is accepted or rejected by one
 * authenticated request: 2xx accepts, a non-transient 4xx rejects the token,
 * anything else is the provider being unavailable. Redirects are refused, so a
 * token is never forwarded to another host.
 */
export function tokenCheckValidator(check: TokenCheck): TokenServiceAccountValidator {
  return async (typed): Promise<TokenServiceAccountValidationResult> => {
    const domain = normalizedField(check.domain, typed, 'domain')
    const workspaceId = normalizedField(check.workspaceId, typed, 'account id')
    const fields = {
      ...typed,
      ...(domain === undefined ? {} : { domain }),
      ...(workspaceId === undefined ? {} : { providerWorkspaceId: workspaceId }),
    }
    const typedDomain = domain === check.defaultDomain ? undefined : domain
    const where = typedDomain ?? workspaceId
    const accepted: TokenServiceAccountValidationResult = {
      displayName: where ? `${check.serviceLabel} (${where})` : check.serviceLabel,
      principal: null,
      auditMetadata: {
        ...(domain === undefined ? {} : { domain }),
        ...(workspaceId === undefined ? {} : { accountId: workspaceId }),
      },
      ...(domain === undefined ? {} : { normalizedDomain: domain }),
      ...(workspaceId === undefined ? {} : { normalizedWorkspaceId: workspaceId }),
    }
    const request = check.request(fields)
    const response: ProviderResponse = check.egress
      ? await sendThroughEgress(check.egress, request)
      : await fetchProvider(
          request.url,
          {
            method: request.method ?? 'GET',
            headers: request.headers,
            body: request.body,
            redirect: 'error',
          },
          'verify',
          // A host built from the typed domain or account id that doesn't exist is the user's typo.
          (typedDomain === undefined || check.domainIsVendorRegion) && workspaceId === undefined
            ? undefined
            : { dnsFailureCode: 'site_not_found' }
        )
    const scopedForbidden = check.forbiddenMeansScoped && isVendorJsonForbidden(response)
    if ((check.rejectsKey || check.provesKey) && !response.ok) {
      const unreadable = Symbol('unreadable')
      const errorBody = await readJsonBody(response, check.serviceLabel).catch(() => unreadable)
      if (errorBody !== unreadable) {
        if (check.rejectsKey?.(errorBody)) {
          throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
            step: 'verify',
          })
        }
        if (check.provesKey?.(errorBody)) return accepted
      }
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
      throw new TokenServiceAccountValidationError(
        providerFailureCode(response.status),
        response.status,
        {
          step: 'verify',
          body:
            errorBody === unreadable || check.errorBodyEchoesToken
              ? ''
              : truncate(JSON.stringify(errorBody) ?? '', 500),
        }
      )
    }
    if (!scopedForbidden && !response.ok) {
      if (!check.errorBodyEchoesToken) await throwForProviderResponse(response, 'verify')
      // The body echoes the token, so it is dropped unread.
      await response.body?.cancel().catch(() => undefined)
      throw new TokenServiceAccountValidationError(
        providerFailureCode(response.status),
        response.status,
        { step: 'verify' }
      )
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
      const verdict = check.acceptsBody(body)
      if (!verdict) {
        throw new TokenServiceAccountValidationError('invalid_credentials', 400, { step: 'verify' })
      }
      const expiresAt = credibleExpiry(check, { headers: response.headers, body })
      if (typeof verdict === 'object') {
        const name = verdict.displayName
        return withExpiry(
          { ...accepted, displayName: where ? `${name} (${where})` : name },
          expiresAt
        )
      }
      return withExpiry(accepted, expiresAt)
    }
    await response.body?.cancel().catch(() => undefined)
    return withExpiry(
      accepted,
      response.ok
        ? credibleExpiry(check, { headers: response.headers, body: undefined })
        : undefined
    )
  }
}
