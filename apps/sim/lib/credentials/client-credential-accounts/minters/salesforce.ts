import {
  normalizeSalesforceMyDomainHost,
  SALESFORCE_MY_DOMAIN_HOST_REGEX,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountIdentity,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  fetchProvider,
  isTransientProviderStatus,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

/**
 * Salesforce never returns `expires_in` on client-credentials responses —
 * opaque-token lifetime is the run-as user's org session timeout (2h default,
 * 15min minimum), unknowable from the response. Cache conservatively for 10
 * minutes (safely below the 15-minute floor) and rely on re-minting.
 */
const SALESFORCE_TOKEN_TTL_SECONDS = 600

interface SalesforceTokenResponse {
  access_token?: string
  instance_url?: string
  scope?: string
}

interface SalesforceUserinfoResponse {
  name?: string
  preferred_username?: string
  organization_id?: string
}

/**
 * Maps a parsed Salesforce token-endpoint error body to an operator-facing
 * hint for server logs. Salesforce returns HTTP 400 for every credential
 * problem, so `error`/`error_description` are the only way to tell a bad
 * consumer key/secret apart from a misconfigured Connected App.
 */
function salesforceErrorHint(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: string; error_description?: string }
    const error = parsed.error ?? ''
    if (error.startsWith('invalid_client')) {
      return 'consumer key or consumer secret is invalid'
    }
    if (error === 'invalid_grant') {
      return 'Client Credentials Flow is not enabled on the Connected App, no "Run As" user is configured, or the Run As user is deactivated/frozen'
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Reads the `exp` claim (epoch seconds) from a JWT-format access token.
 * Orgs with "Issue JSON Web Token (JWT)-Based Access Tokens" enabled embed
 * the hard expiry in the token itself (never in an `expires_in` field).
 * @returns The exp claim, or undefined when the token is not a decodable JWT
 */
function decodeJwtExpSeconds(token: string): number | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: number
    }
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}

/**
 * Derives a conservative cache TTL: 10 minutes for opaque tokens (lifetime is
 * unknowable from the response), or `exp - 60s` clamped to at most 10 minutes
 * when the token is a JWT carrying a hard expiry.
 */
function salesforceTokenTtlSeconds(accessToken: string): number {
  const exp = decodeJwtExpSeconds(accessToken)
  if (exp === undefined) return SALESFORCE_TOKEN_TTL_SECONDS
  const remaining = exp - Math.floor(Date.now() / 1000) - 60
  return Math.min(Math.max(remaining, 0), SALESFORCE_TOKEN_TTL_SECONDS)
}

/**
 * Best-effort identity lookup for the run-as integration user via the
 * standard userinfo endpoint. A failure never fails the mint — the caller
 * falls back to a host-derived display name.
 */
async function fetchSalesforceIdentity(
  accessToken: string,
  instanceUrl: string,
  host: string
): Promise<ClientCredentialAccountIdentity> {
  const fallback: ClientCredentialAccountIdentity = {
    displayName: `Salesforce ${host}`,
    auditMetadata: { salesforceMyDomainHost: host },
    storedMetadata: { myDomainHost: host, instanceUrl },
  }
  try {
    const res = await fetchProvider(
      `${instanceUrl}/services/oauth2/userinfo`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      'salesforce_identity'
    )
    if (!res.ok) return fallback
    const user = await parseProviderJson<SalesforceUserinfoResponse>(res, 'salesforce_identity')
    const username =
      typeof user.preferred_username === 'string' && user.preferred_username
        ? user.preferred_username
        : undefined
    const name = typeof user.name === 'string' && user.name ? user.name : undefined
    const orgId =
      typeof user.organization_id === 'string' && user.organization_id
        ? user.organization_id
        : undefined
    return {
      displayName: name ?? username ?? fallback.displayName,
      auditMetadata: {
        salesforceMyDomainHost: host,
        ...(orgId ? { salesforceOrgId: orgId } : {}),
        ...(username ? { salesforceRunAsUsername: username } : {}),
      },
      storedMetadata: {
        myDomainHost: host,
        instanceUrl,
        ...(orgId ? { orgId } : {}),
        ...(username ? { runAsUsername: username } : {}),
      },
    }
  } catch {
    return fallback
  }
}

/**
 * Mints a Salesforce access token via the OAuth 2.0 Client Credentials Flow
 * against the org's own My Domain token endpoint
 * (`https://{host}/services/oauth2/token` — login.salesforce.com hard-rejects
 * this grant). Credentials ride in the form body (client_secret_post) with no
 * scope parameter (Salesforce doesn't support scopes on this endpoint; grants
 * come from the Connected App config). The host is SSRF-guarded against the
 * My Domain allowlist before any outbound fetch.
 *
 * Salesforce reports every credential/configuration failure as HTTP 400 with
 * `{ error, error_description }` (invalid_client_id, invalid_client,
 * invalid_grant), so 4xx maps to `invalid_credentials` — except transient
 * 429/408 throttling statuses, which map to `provider_unavailable` alongside
 * 5xx/network failures (never blame the credentials for provider-side
 * throttling). A host that fails DNS resolution maps to `site_not_found`
 * (the pasted My Domain host is wrong, not Salesforce down). The response
 * carries no `expires_in` and no refresh token — see
 * {@link SALESFORCE_TOKEN_TTL_SECONDS}.
 */
export async function mintSalesforceServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const host = normalizeSalesforceMyDomainHost(fields.orgId)
  if (!SALESFORCE_MY_DOMAIN_HOST_REGEX.test(host)) {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      host,
      reason:
        'host is not a Salesforce My Domain host (expected *.my.salesforce.com, *.sandbox.my.salesforce.com, or *.develop.my.salesforce.com — never login.salesforce.com)',
    })
  }

  const res = await fetchProvider(
    `https://${host}/services/oauth2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: fields.clientSecret,
      }).toString(),
    },
    'salesforce_token_mint',
    {
      dnsFailureCode: 'site_not_found',
      dnsFailureReason: 'host does not resolve — check the My Domain host',
    }
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status >= 400 && res.status < 500 && !isTransientProviderStatus(res.status)) {
      const hint = salesforceErrorHint(body)
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: 'salesforce_token_mint',
        host,
        body,
        ...(hint ? { hint } : {}),
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: 'salesforce_token_mint',
      host,
      body,
    })
  }

  const payload = await parseProviderJson<SalesforceTokenResponse>(res, 'salesforce_token_mint')
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'salesforce_token_mint',
      host,
      reason: 'token response missing access_token',
    })
  }

  // The response's instance_url is authoritative (it can differ from the
  // stored My Domain host on enhanced-domain orgs), but it is only trusted for
  // follow-up fetches when it is an https *.salesforce.com URL — otherwise the
  // validated My Domain host is used.
  const instanceUrl = normalizeInstanceUrl(payload.instance_url, host)
  const grantedScopes =
    typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : undefined

  if (options?.skipIdentity) {
    return {
      accessToken: payload.access_token,
      expiresInSeconds: salesforceTokenTtlSeconds(payload.access_token),
      instanceUrl,
      grantedScopes,
    }
  }

  const identity = await fetchSalesforceIdentity(payload.access_token, instanceUrl, host)
  if (grantedScopes?.length) {
    identity.storedMetadata = {
      ...identity.storedMetadata,
      grantedScopes: grantedScopes.join(' '),
    }
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds: salesforceTokenTtlSeconds(payload.access_token),
    instanceUrl,
    grantedScopes,
    identity,
  }
}

/**
 * Validates the mint response's `instance_url` (https, `*.salesforce.com`
 * host, no path) and normalizes away any trailing slash; falls back to the
 * already-SSRF-validated My Domain host when the value is absent or fails
 * validation.
 */
function normalizeInstanceUrl(rawInstanceUrl: string | undefined, host: string): string {
  const fallback = `https://${host}`
  if (typeof rawInstanceUrl !== 'string' || !rawInstanceUrl) return fallback
  try {
    const url = new URL(rawInstanceUrl)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.salesforce.com')) return fallback
    return `https://${url.hostname}`
  } catch {
    return fallback
  }
}
