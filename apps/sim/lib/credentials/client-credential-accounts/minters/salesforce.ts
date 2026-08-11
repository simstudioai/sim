import { createPrivateKey, type KeyObject } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { SignJWT } from 'jose'
import {
  normalizeSalesforceMyDomainHost,
  resolveSalesforceAuthMethod,
  SALESFORCE_MY_DOMAIN_HOST_REGEX,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountIdentity,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isTransientProviderStatus,
  parseProviderJson,
  providerFailureReason,
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

const IDENTITY_STEP = 'salesforce_identity'

const TOKEN_MINT_STEP = 'salesforce_token_mint'

/**
 * Lifetime of the signed assertion, not of the access token it buys. Salesforce
 * documents a 5-minute ceiling; a short window bounds replay while leaving room
 * for clock skew. The binding constraint is the lower bound — a Sim clock more
 * than this far behind Salesforce's fails every mint.
 */
const JWT_ASSERTION_LIFETIME_SECONDS = 180

const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

const logger = createLogger('SalesforceServiceAccountMinter')

interface SalesforceTokenResponse {
  access_token?: string
  instance_url?: string
  scope?: string
}

/**
 * `/services/oauth2/userinfo` returns `user_id`, `organization_id`,
 * `preferred_username`, and `name` in the same call the display name already
 * needs, so capturing the run-as user id costs no extra request. `sub` is
 * deliberately unused — Salesforce documents it as the UserInfo endpoint URL,
 * not a subject identifier.
 * @see https://help.salesforce.com/s/articleView?id=sf.remoteaccess_using_userinfo_endpoint.htm&type=5
 */
interface SalesforceUserinfoResponse {
  name?: string
  preferred_username?: string
  organization_id?: string
  user_id?: string
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
 * standard userinfo endpoint. A failure never fails the mint — the credential
 * degrades to a host-derived display name with a `lookup_failed` principal, so
 * the audit record shows the identity was not captured rather than implying
 * none exists.
 */
async function fetchSalesforceIdentity(
  accessToken: string,
  instanceUrl: string,
  host: string
): Promise<ClientCredentialAccountIdentity> {
  /**
   * `label` keeps whatever human name userinfo did return. A response can carry
   * `name`/`preferred_username` but no `user_id` — the principal is then
   * unusable, but the label still beats the host fallback, so only the
   * principal degrades and the credential does not silently lose its name.
   */
  const degraded = (reason: string, label?: string): ClientCredentialAccountIdentity => ({
    displayName: label ?? `Salesforce ${host}`,
    principal: { kind: 'lookup_failed', reason },
    auditMetadata: { salesforceMyDomainHost: host },
    storedMetadata: { myDomainHost: host, instanceUrl },
  })
  try {
    const res = await fetchProvider(
      `${instanceUrl}/services/oauth2/userinfo`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      IDENTITY_STEP
    )
    if (!res.ok) {
      logger.warn('Salesforce run-as identity lookup failed', {
        step: IDENTITY_STEP,
        status: res.status,
        host,
      })
      return degraded(`HTTP ${res.status}`)
    }
    const user = await parseProviderJson<SalesforceUserinfoResponse>(res, IDENTITY_STEP)
    const username =
      typeof user.preferred_username === 'string' && user.preferred_username
        ? user.preferred_username
        : undefined
    const name = typeof user.name === 'string' && user.name ? user.name : undefined
    const orgId =
      typeof user.organization_id === 'string' && user.organization_id
        ? user.organization_id
        : undefined
    const userId = typeof user.user_id === 'string' && user.user_id ? user.user_id : undefined
    if (!userId) {
      logger.warn('Salesforce userinfo response carried no user_id', {
        step: IDENTITY_STEP,
        status: res.status,
        host,
      })
      return degraded('response missing user_id', name ?? username)
    }
    return {
      displayName: name ?? username ?? `Salesforce ${host}`,
      // The 18-char user id is immutable; `preferred_username` is renameable,
      // so it is only a label.
      principal: userPrincipal(userId, username),
      auditMetadata: {
        salesforceMyDomainHost: host,
        ...(orgId ? { salesforceOrgId: orgId } : {}),
      },
      storedMetadata: {
        myDomainHost: host,
        instanceUrl,
        ...(orgId ? { orgId } : {}),
      },
    }
  } catch (error) {
    logger.warn('Salesforce run-as identity lookup threw', {
      step: IDENTITY_STEP,
      host,
      error: getErrorMessage(error),
    })
    return degraded(providerFailureReason(error))
  }
}

/**
 * Loads a pasted PEM private key. Accepts both PKCS#8
 * (`-----BEGIN PRIVATE KEY-----`, what OpenSSL 3 emits) and PKCS#1
 * (`-----BEGIN RSA PRIVATE KEY-----`, what OpenSSL 1.x emits) because
 * Salesforce's own `openssl` recipe produces whichever the operator's OpenSSL
 * defaults to. An encrypted key is rejected explicitly rather than surfacing
 * OpenSSL's opaque "bad decrypt" — Sim collects no passphrase to unlock one.
 */
function loadSalesforcePrivateKey(privateKeyPem: string): KeyObject {
  if (/ENCRYPTED PRIVATE KEY/.test(privateKeyPem)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'jwt_key_load',
      reason:
        'private key is passphrase-protected — decrypt it first (openssl rsa -in server.pass.key -out server.key)',
    })
  }
  try {
    const key = createPrivateKey(privateKeyPem)
    if (key.asymmetricKeyType !== 'rsa') {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'jwt_key_load',
        reason: `Salesforce requires an RSA key for RS256, received ${key.asymmetricKeyType ?? 'an unrecognized key type'}`,
      })
    }
    // Signing is synchronous OpenSSL work on the libuv threadpool, and cost
    // grows sharply with modulus size. Salesforce's own recipe is 2048-bit;
    // anything past 4096 is a way to burn threadpool slots, not a real key.
    const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0
    if (modulusLength > 4096) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'jwt_key_load',
        reason: `RSA key is ${modulusLength}-bit; 4096 is the maximum accepted`,
      })
    }
    return key
  } catch (error) {
    if (error instanceof TokenServiceAccountValidationError) throw error
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'jwt_key_load',
      reason: 'private key is not a readable PEM key',
    })
  }
}

/**
 * Builds the RS256-signed assertion Salesforce exchanges for an access token.
 *
 * `aud` is the org's own My Domain URL rather than `login.salesforce.com` /
 * `test.salesforce.com`. Salesforce ended legacy hostname redirections in
 * Spring '26, and External Client Apps now reject the generic sandbox host
 * with `app_not_found` because it cannot identify which org the app is
 * installed in. My Domain is valid for Connected Apps and External Client Apps
 * alike, in production and in sandboxes, and is what Salesforce's own CLI
 * recommends — so the stored host alone determines the environment, with
 * nothing left to infer.
 *
 * Government Cloud is the documented exception: `sfdx-core` substitutes
 * `https://gs1.salesforce.com` for `gs1` orgs, whose hosts are otherwise
 * ordinary `*.my.salesforce.com`.
 *
 * @see https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm&type=5
 * @see https://github.com/forcedotcom/sfdx-core/blob/main/src/util/sfdcUrl.ts
 */
function buildSalesforceJwtAssertion(
  consumerKey: string,
  username: string,
  host: string,
  privateKey: KeyObject
): Promise<string> {
  return (
    new SignJWT()
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(consumerKey)
      .setSubject(username)
      .setAudience(salesforceJwtAudience(host))
      // Optional per RFC 7523, but every mainstream Salesforce implementation
      // (including `sfdx-core`) sends it; costs nothing to match them.
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + JWT_ASSERTION_LIFETIME_SECONDS)
      .sign(privateKey)
  )
}

/**
 * Government Cloud orgs authenticate at a dedicated audience; everyone else
 * uses My Domain.
 *
 * Matched on the exact GovCloud host (or a subdomain of it) rather than a
 * `gs1` prefix: `sfdx-core`'s other GovCloud signal is the org's
 * `createdOrgInstance`, which we never see, and a prefix test would misroute
 * an ordinary org that merely starts with those characters — breaking a setup
 * that works today. A miss here simply falls back to My Domain, which is the
 * behaviour before this branch existed.
 */
const SALESFORCE_GOV_CLOUD_HOST = 'gs1.my.salesforce.com'

function salesforceJwtAudience(host: string): string {
  const isGovCloud =
    host === SALESFORCE_GOV_CLOUD_HOST || host.endsWith(`.${SALESFORCE_GOV_CLOUD_HOST}`)
  return isGovCloud ? 'https://gs1.salesforce.com' : `https://${host}`
}

/**
 * Maps a JWT-bearer token error to an operator-facing hint. Salesforce
 * collapses every JWT failure into HTTP 400 `invalid_grant`, distinguishing
 * them only by `error_description`, so the description is the sole signal for
 * which half of the setup is wrong.
 *
 * Substring matching is safe here precisely because the result only ever
 * decorates a log line: the thrown code is `invalid_credentials` either way,
 * so an unrecognized wording degrades to "no hint" and never changes
 * behaviour. Prefer the structured `error` field wherever Salesforce sets one.
 */
function salesforceJwtErrorHint(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: string; error_description?: string }
    const description = (parsed.error_description ?? '').toLowerCase()
    if (parsed.error === 'app_not_found') {
      return 'the app is not installed in this org — check the My Domain host and that the consumer key belongs to that org'
    }
    if (parsed.error === 'invalid_app_access' || description.includes('admin approved')) {
      return "the run-as user's profile or permission set is not assigned to the app — assign it under the app's OAuth policies"
    }
    if (description.includes('user hasn’t approved') || description.includes("hasn't approved")) {
      return 'the run-as user has not approved the app — set its OAuth policy to "Admin approved users are pre-authorized" and assign the user a permitted profile or permission set'
    }
    if (description.includes('audience')) {
      return 'the app rejected the audience — confirm the My Domain host matches the org the app is installed in'
    }
    if (description.includes('invalid assertion') || description.includes('invalid signature')) {
      return 'the assertion signature did not verify — the uploaded certificate does not match this private key'
    }
    if (description.includes('client identifier') || parsed.error === 'invalid_client_id') {
      return 'the consumer key is invalid for this org'
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Builds the token-request form body for the selected grant, and the hint
 * mapper that reads the failures that grant can produce.
 *
 * Client credentials posts the consumer key + secret directly
 * (client_secret_post) with no scope parameter — Salesforce doesn't support
 * scopes on this endpoint; grants come from the app config. JWT bearer posts a
 * signed assertion instead, and carries no client secret at all.
 */
async function buildSalesforceTokenRequest(
  fields: ClientCredentialAccountFields,
  host: string
): Promise<{ body: string; hintFor: (body: string) => string | undefined }> {
  if (resolveSalesforceAuthMethod(fields.authMethod) === 'jwt_bearer') {
    const consumerKey = fields.clientId.trim()
    const username = fields.username?.trim()
    const privateKeyPem = fields.privateKey?.trim()
    if (!username || !privateKeyPem) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'jwt_field_validation',
        host,
        reason: 'JWT bearer requires both a run-as username and a private key',
      })
    }
    const assertion = await buildSalesforceJwtAssertion(
      consumerKey,
      username,
      host,
      loadSalesforcePrivateKey(privateKeyPem)
    )
    return {
      body: new URLSearchParams({
        grant_type: JWT_BEARER_GRANT_TYPE,
        assertion,
      }).toString(),
      hintFor: salesforceJwtErrorHint,
    }
  }

  const clientSecret = fields.clientSecret?.trim()
  if (!clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'client_credentials_field_validation',
      host,
      reason: 'client credentials requires a consumer secret',
    })
  }
  return {
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: fields.clientId,
      client_secret: clientSecret,
    }).toString(),
    hintFor: salesforceErrorHint,
  }
}

/**
 * Mints a Salesforce access token against the org's own My Domain token
 * endpoint (`https://{host}/services/oauth2/token`), using either the OAuth
 * 2.0 Client Credentials Flow or the JWT Bearer Flow depending on the
 * credential's `authMethod`. login.salesforce.com hard-rejects the
 * client-credentials grant, and Spring '26 made the My Domain host the only
 * audience an External Client App accepts, so both grants target the org host.
 * It is SSRF-guarded against the My Domain allowlist before any outbound
 * fetch, and — because the assertion's `aud` is that same validated host — the
 * guard also bounds where a signed assertion can be replayed.
 *
 * Salesforce reports every credential/configuration failure as HTTP 400 with
 * `{ error, error_description }` (invalid_client_id, invalid_client,
 * invalid_grant, app_not_found), so 4xx maps to `invalid_credentials` — except
 * transient 429/408 throttling statuses, which map to `provider_unavailable`
 * alongside 5xx/network failures (never blame the credentials for
 * provider-side throttling). A host that fails DNS resolution maps to
 * `site_not_found` (the pasted My Domain host is wrong, not Salesforce down).
 * Neither grant returns `expires_in` or a refresh token — see
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

  const { body: requestBody, hintFor } = await buildSalesforceTokenRequest(fields, host)

  const res = await fetchProvider(
    `https://${host}/services/oauth2/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: requestBody,
    },
    TOKEN_MINT_STEP,
    {
      dnsFailureCode: 'site_not_found',
      dnsFailureReason: 'host does not resolve — check the My Domain host',
    }
  )

  if (!res.ok) {
    const body = await readProviderErrorSnippet(res)
    if (res.status >= 400 && res.status < 500 && !isTransientProviderStatus(res.status)) {
      const hint = hintFor(body)
      throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
        step: TOKEN_MINT_STEP,
        host,
        body,
        ...(hint ? { hint } : {}),
      })
    }
    throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
      step: TOKEN_MINT_STEP,
      host,
      body,
    })
  }

  const payload = await parseProviderJson<SalesforceTokenResponse>(res, TOKEN_MINT_STEP)
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_MINT_STEP,
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
