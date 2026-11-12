import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  normalizeZendeskSubdomain,
  resolveZendeskAuthMethod,
  ZENDESK_AUTH_METHODS,
  ZENDESK_SCOPES,
  ZENDESK_SUBDOMAIN_REGEX,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  providerFailureCode,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throttledRetryAfterMs,
} from '@/lib/credentials/token-service-accounts/errors'
import { zendeskApiTokenCredential } from '@/tools/zendesk/types'

const MINT_STEP = 'zendesk_token_mint'
const IDENTITY_STEP = 'zendesk_users_me'
const MAX_RESPONSE_BYTES = 64 * 1024
/** Lifetime Sim requests; Zendesk accepts 300 seconds to 2 days. */
const REQUESTED_TOKEN_LIFETIME_SECONDS = 3600
/** An API-token sign-in mints nothing, so its derived credential is simply re-derived hourly. */
const API_TOKEN_LIFETIME_SECONDS = 3600
const STAFF_ROLES: ReadonlySet<string> = new Set(['agent', 'admin'])

function refuse(
  code: 'invalid_credentials' | 'site_not_found' | 'provider_unavailable',
  status: number,
  step: string,
  reason: string
): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError(code, status, { step, reason })
}

async function readJson(
  response: Response,
  label: string,
  step: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  try {
    const payload = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      label,
      signal,
    })
    if (isRecordLike(payload)) return payload
  } catch {
    signal?.throwIfAborted()
  }
  throw refuse('provider_unavailable', 502, step, 'provider returned an invalid response')
}

async function throwForZendeskResponse(response: Response, step: string): Promise<void> {
  if (response.ok) return
  const body = await readProviderErrorSnippet(response)
  throw new TokenServiceAccountValidationError(
    response.status === 404 ? 'site_not_found' : providerFailureCode(response.status),
    response.status,
    { step, body },
    { retryAfterMs: throttledRetryAfterMs(response) }
  )
}

/**
 * Exchanges a confidential OAuth client's credentials for a bearer token. Zendesk documents the
 * grant only for confidential clients, as JSON, with a required scope and an optional
 * `expires_in` it caps at two days; the token acts as the user the client belongs to.
 */
async function exchangeClientCredentials(
  base: string,
  fields: ClientCredentialAccountFields,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const scope = fields.scope?.trim() ?? ''
  if (!fields.clientId || !fields.clientSecret || !ZENDESK_SCOPES.has(scope)) {
    throw refuse('invalid_credentials', 400, MINT_STEP, 'client, secret, or scope is missing')
  }
  const response = await fetchProvider(
    `${base}/oauth/tokens`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: fields.clientId,
        client_secret: fields.clientSecret,
        scope,
        expires_in: REQUESTED_TOKEN_LIFETIME_SECONDS,
      }),
      cache: 'no-store',
      signal,
    },
    MINT_STEP,
    { dnsFailureCode: 'site_not_found', dnsFailureReason: 'subdomain does not resolve' }
  )
  await throwForZendeskResponse(response, MINT_STEP)
  const token = await readJson(response, 'Zendesk token response', MINT_STEP, signal)
  if (typeof token.access_token !== 'string' || !token.access_token.trim()) {
    throw refuse('provider_unavailable', 502, MINT_STEP, 'token response has no access token')
  }
  // Older clients may answer without a lifetime; never trust it beyond what Sim requested.
  const reported =
    typeof token.expires_in === 'number' &&
    Number.isSafeInteger(token.expires_in) &&
    token.expires_in > 0
      ? token.expires_in
      : REQUESTED_TOKEN_LIFETIME_SECONDS
  return {
    accessToken: token.access_token,
    expiresInSeconds: Math.min(reported, REQUESTED_TOKEN_LIFETIME_SECONDS),
  }
}

/**
 * Proves the credential signs in as a real staff member. Zendesk allows anonymous callers on
 * `users/me` but does not document that response's body, so a positive integer id is required
 * rather than trusting any user object; an end user cannot use the ticketing API the tools call.
 */
async function verifyStaffUser(
  base: string,
  authorization: string,
  subdomain: string,
  signal?: AbortSignal
): Promise<NonNullable<ClientCredentialAccountMintResult['identity']>> {
  const response = await fetchProvider(
    `${base}/api/v2/users/me.json`,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authorization },
      cache: 'no-store',
      signal,
    },
    IDENTITY_STEP
  )
  await throwForZendeskResponse(response, IDENTITY_STEP)
  const payload = await readJson(response, 'Zendesk user response', IDENTITY_STEP, signal)
  const user = isRecordLike(payload.user) ? payload.user : undefined
  const id = user?.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw refuse('invalid_credentials', 401, IDENTITY_STEP, 'credential signs in anonymously')
  }
  if (typeof user?.role !== 'string' || !STAFF_ROLES.has(user.role)) {
    throw refuse('invalid_credentials', 403, IDENTITY_STEP, 'user is not an agent or admin')
  }
  const email = typeof user.email === 'string' && user.email ? user.email : undefined
  const name = typeof user.name === 'string' && user.name ? user.name : undefined
  return {
    displayName: `Zendesk ${subdomain}${email ? ` (${email})` : ''}`,
    principal: userPrincipal(String(id), email ?? name),
    auditMetadata: { zendeskSubdomain: subdomain, zendeskRole: user.role },
    storedMetadata: { zendeskRole: user.role },
  }
}

/**
 * Resolves a Zendesk credential to the authorization the Zendesk tools send. The OAuth client
 * branch mints a bearer token through the client-credentials grant; the API-token branch derives
 * the documented `{email}/token:{api_token}` Basic credential without a network call. Both act
 * only on `{subdomain}.zendesk.com`, and the connect-time check requires a real agent or admin.
 *
 * @see https://developer.zendesk.com/api-reference/ticketing/oauth/grant_type_tokens/
 * @see https://developer.zendesk.com/api-reference/introduction/security-and-auth/
 */
export async function mintZendeskServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  options?.signal?.throwIfAborted()
  const subdomain = normalizeZendeskSubdomain(fields.orgId)
  if (!ZENDESK_SUBDOMAIN_REGEX.test(subdomain)) {
    throw refuse('site_not_found', 400, 'host_validation', 'not a Zendesk subdomain')
  }
  const base = `https://${subdomain}.zendesk.com`

  let minted: Pick<
    ClientCredentialAccountMintResult,
    'accessToken' | 'expiresInSeconds' | 'authStyle'
  >
  let authorization: string
  if (resolveZendeskAuthMethod(fields.authMethod) === ZENDESK_AUTH_METHODS.apiToken) {
    const email = fields.username?.trim()
    if (!email || !fields.apiToken) {
      throw refuse('invalid_credentials', 400, MINT_STEP, 'agent email or API token is missing')
    }
    const basic = zendeskApiTokenCredential(email, fields.apiToken)
    minted = {
      accessToken: basic,
      expiresInSeconds: API_TOKEN_LIFETIME_SECONDS,
      authStyle: 'basic',
    }
    authorization = `Basic ${basic}`
  } else {
    const exchanged = await exchangeClientCredentials(base, fields, options?.signal)
    minted = exchanged
    authorization = `Bearer ${exchanged.accessToken}`
  }

  return {
    ...minted,
    domain: subdomain,
    ...(options?.skipIdentity
      ? {}
      : { identity: await verifyStaffUser(base, authorization, subdomain, options?.signal) }),
  }
}
