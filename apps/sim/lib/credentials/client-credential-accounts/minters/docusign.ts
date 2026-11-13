import { createPrivateKey, type KeyObject } from 'crypto'
import { SignJWT } from 'jose'
import {
  DOCUSIGN_ENVIRONMENTS,
  DOCUSIGN_GUID_REGEX,
  DOCUSIGN_JWT_SCOPES,
  type DocuSignEnvironment,
  resolveDocuSignEnvironment,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type {
  ClientCredentialAccountFields,
  ClientCredentialAccountMintOptions,
  ClientCredentialAccountMintResult,
} from '@/lib/credentials/client-credential-accounts/server'
import { userPrincipal } from '@/lib/credentials/principal'
import {
  fetchProvider,
  isTransientProviderStatus,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throttledRetryAfterMs,
} from '@/lib/credentials/token-service-accounts/errors'

const TOKEN_STEP = 'docusign_token_mint'
const USERINFO_STEP = 'docusign_userinfo'
const VALIDATION_STEP = 'docusign_field_validation'

const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

/**
 * Lifetime of the signed assertion (not the access token). DocuSign defaults
 * `exp` to an hour after `iat`; a short window bounds replay.
 */
const JWT_ASSERTION_LIFETIME_SECONDS = 300

/**
 * DocuSign advises fetching a new token about 15 minutes before the old one
 * expires. The resolver re-mints once less than 5 minutes remain, so reporting
 * 10 minutes less than `expires_in` lands the re-mint at the advised point.
 * @see https://developers.docusign.com/platform/auth/jwt/jwt-get-token/
 */
const TOKEN_EXPIRY_MARGIN_SECONDS = 600
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600

/**
 * Floor for the reported lifetime when DocuSign ever returns a short
 * `expires_in`: one minute above the resolver's 5-minute reuse threshold, so a
 * token is reused briefly instead of re-minted on every call. Never more than
 * a minute short of the real expiry.
 */
const SHORT_TOKEN_CACHE_SECONDS = 360
const SHORT_TOKEN_EXPIRY_MARGIN_SECONDS = 60

/** Smallest RSA key DocuSign's RS256 signing accepts in `jose`. */
const MIN_RSA_MODULUS_BITS = 2048

/** Lifetime to report to the token cache for a token that really lasts `lifetime` seconds. */
function cacheLifetimeSeconds(lifetime: number): number {
  const advised = lifetime - TOKEN_EXPIRY_MARGIN_SECONDS
  const shortTokenFloor = Math.min(
    lifetime - SHORT_TOKEN_EXPIRY_MARGIN_SECONDS,
    SHORT_TOKEN_CACHE_SECONDS
  )
  return Math.max(advised, shortTokenFloor, 0)
}

/**
 * eSignature REST hosts per environment. Demo accounts live only on
 * `demo.docusign.net`; production accounts on a regional `*.docusign.net`
 * host (`na3`, `eu`, …). A `base_uri` outside its environment's shape is never
 * trusted with the token.
 */
const DEMO_BASE_URI_HOST = 'demo.docusign.net'
const PRODUCTION_BASE_URI_HOST_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.docusign\.net$/

interface DocuSignTokenResponse {
  access_token?: string
  expires_in?: number
}

interface DocuSignUserinfoAccount {
  account_id?: unknown
  is_default?: unknown
  account_name?: unknown
  base_uri?: unknown
}

interface DocuSignUserinfoResponse {
  sub?: unknown
  name?: unknown
  email?: unknown
  accounts?: unknown
}

function invalid(reason: string, step = VALIDATION_STEP): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('invalid_credentials', 400, { step, reason })
}

/**
 * Loads the pasted RSA key. DocuSign generates PKCS#1 (`BEGIN RSA PRIVATE
 * KEY`); PKCS#8 is accepted too. Encrypted keys and certificates fail to load
 * (Sim collects no passphrase). Keys under 2048 bits are refused because
 * `jose` will not sign RS256 with them, and keys past 4096 bits because signing
 * cost grows sharply with modulus size.
 */
function loadDocuSignPrivateKey(privateKeyPem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPrivateKey(privateKeyPem)
  } catch {
    throw invalid('private key is not a readable PEM key')
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw invalid('DocuSign signs assertions with RS256, which needs an RSA key')
  }
  const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0
  if (modulusLength < MIN_RSA_MODULUS_BITS) {
    throw invalid(
      `RSA key is ${modulusLength}-bit; generate a 2048-bit keypair on the integration key`
    )
  }
  if (modulusLength > 4096) {
    throw invalid('RSA key is larger than 4096 bits')
  }
  return key
}

interface ValidatedDocuSignFields {
  environment: DocuSignEnvironment
  integrationKey: string
  userId: string
  accountId?: string
  key: KeyObject
}

/** Rejects malformed input before anything is signed or sent. */
function validateDocuSignFields(fields: ClientCredentialAccountFields): ValidatedDocuSignFields {
  const environment = resolveDocuSignEnvironment(fields.dataCenter)
  if (!environment) throw invalid('environment must be demo or production')
  const integrationKey = fields.clientId.trim()
  if (!DOCUSIGN_GUID_REGEX.test(integrationKey)) throw invalid('integration key is not a GUID')
  const userId = fields.username?.trim() ?? ''
  if (!DOCUSIGN_GUID_REGEX.test(userId)) throw invalid('impersonated user ID is not a GUID')
  const accountId = fields.orgId.trim() || undefined
  if (accountId && !DOCUSIGN_GUID_REGEX.test(accountId)) throw invalid('account ID is not a GUID')
  const key = loadDocuSignPrivateKey(fields.privateKey?.trim() ?? '')
  return { environment, integrationKey, userId, accountId, key }
}

/**
 * Maps a JWT Grant token error to an operator-facing hint for server logs.
 * DocuSign reports every failure as HTTP 400 `{ error, error_description }`.
 */
function docuSignErrorHint(error: string, description: string): string | undefined {
  if (error === 'consent_required') {
    return 'the impersonated user has not granted (or revoked) consent for this integration key'
  }
  switch (description) {
    case 'issuer_not_found':
      return 'integration key not found in this environment'
    case 'user_not_found':
      return 'impersonated user ID not found in this environment'
    case 'no_valid_keys_or_signatures':
      return 'private key does not match an RSA keypair on this integration key, or the clock is skewed'
    default:
      return undefined
  }
}

function parseErrorBody(body: string): { error: string; description: string } {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown }
    return {
      error: typeof parsed.error === 'string' ? parsed.error : '',
      description: typeof parsed.error_description === 'string' ? parsed.error_description : '',
    }
  } catch {
    return { error: '', description: '' }
  }
}

/**
 * The eSignature REST base for one account, or `undefined` when its
 * `base_uri` is not an https host of the credential's environment.
 */
function accountApiBase(
  account: DocuSignUserinfoAccount,
  environment: DocuSignEnvironment
): string | undefined {
  if (typeof account.base_uri !== 'string' || typeof account.account_id !== 'string') return
  if (!DOCUSIGN_GUID_REGEX.test(account.account_id)) return
  let url: URL
  try {
    url = new URL(account.base_uri)
  } catch {
    return
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return
  const host = url.hostname.toLowerCase()
  const allowed =
    environment === 'demo'
      ? host === DEMO_BASE_URI_HOST
      : host !== DEMO_BASE_URI_HOST && PRODUCTION_BASE_URI_HOST_REGEX.test(host)
  if (!allowed) return
  return `https://${host}/restapi/v2.1/accounts/${account.account_id.toLowerCase()}`
}

/**
 * Mints a DocuSign access token with the JWT Grant: an RS256 assertion
 * (`iss` = integration key, `sub` = impersonated user, `aud` = the
 * environment's authentication host, scope `signature impersonation`) posted
 * to `https://{aud}/oauth/token`. Tokens last an hour and carry no refresh
 * token, so they are re-minted.
 *
 * Every mint also reads `/oauth/userinfo` to pick the account (the pinned
 * Account ID, else the user's default) and returns its eSignature REST base as
 * `instanceUrl`, so tools never resolve the account against the deployment's
 * OAuth host. DocuSign rate-limits userinfo per user per hour; one call per
 * mint stays well inside it.
 *
 * Both hosts come only from the stored environment, never from input.
 * @see https://developers.docusign.com/platform/auth/jwt/jwt-get-token/
 * @see https://developers.docusign.com/platform/auth/reference/user-info/
 */
export async function mintDocuSignServiceAccountToken(
  fields: ClientCredentialAccountFields,
  options?: ClientCredentialAccountMintOptions
): Promise<ClientCredentialAccountMintResult> {
  const { environment, integrationKey, userId, accountId, key } = validateDocuSignFields(fields)
  const authHost = DOCUSIGN_ENVIRONMENTS[environment].authHost

  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: DOCUSIGN_JWT_SCOPES })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(integrationKey)
    .setSubject(userId)
    // DocuSign: "Do not include https:// in the aud value!"
    .setAudience(authHost)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_ASSERTION_LIFETIME_SECONDS)
    .sign(key)

  const tokenRes = await fetchProvider(
    `https://${authHost}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT_TYPE, assertion }).toString(),
      signal: options?.signal,
    },
    TOKEN_STEP
  )

  if (!tokenRes.ok) {
    const body = await readProviderErrorSnippet(tokenRes)
    if (
      tokenRes.status >= 400 &&
      tokenRes.status < 500 &&
      !isTransientProviderStatus(tokenRes.status)
    ) {
      const { error, description } = parseErrorBody(body)
      const hint = docuSignErrorHint(error, description)
      throw new TokenServiceAccountValidationError(
        error === 'consent_required' ? 'consent_required' : 'invalid_credentials',
        tokenRes.status,
        { step: TOKEN_STEP, environment, body, ...(hint ? { hint } : {}) }
      )
    }
    throw new TokenServiceAccountValidationError(
      'provider_unavailable',
      tokenRes.status,
      { step: TOKEN_STEP, environment, body },
      { retryAfterMs: throttledRetryAfterMs(tokenRes) }
    )
  }

  const payload = await parseProviderJson<DocuSignTokenResponse>(tokenRes, TOKEN_STEP)
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: TOKEN_STEP,
      reason: 'token response missing access_token',
    })
  }
  const accessToken = payload.access_token
  const lifetime =
    typeof payload.expires_in === 'number' && payload.expires_in > 0
      ? payload.expires_in
      : DEFAULT_TOKEN_LIFETIME_SECONDS
  const expiresInSeconds = cacheLifetimeSeconds(lifetime)

  const userinfoRes = await fetchProvider(
    `https://${authHost}/oauth/userinfo`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: options?.signal,
    },
    USERINFO_STEP
  )
  if (!userinfoRes.ok) {
    const body = await readProviderErrorSnippet(userinfoRes)
    throw new TokenServiceAccountValidationError(
      'provider_unavailable',
      userinfoRes.status,
      { step: USERINFO_STEP, environment, body },
      { retryAfterMs: throttledRetryAfterMs(userinfoRes) }
    )
  }
  const userinfo = await parseProviderJson<DocuSignUserinfoResponse>(userinfoRes, USERINFO_STEP)
  const accounts = (Array.isArray(userinfo.accounts) ? userinfo.accounts : []).filter(
    (account): account is DocuSignUserinfoAccount => Boolean(account) && typeof account === 'object'
  )
  const account = accountId
    ? accounts.find(
        (candidate) =>
          typeof candidate.account_id === 'string' &&
          candidate.account_id.toLowerCase() === accountId.toLowerCase()
      )
    : (accounts.find((candidate) => candidate.is_default === true) ?? accounts[0])
  if (!account) {
    throw new TokenServiceAccountValidationError('account_not_found', 400, {
      step: USERINFO_STEP,
      environment,
      reason: accountId
        ? 'the impersonated user is not a member of the pinned account'
        : 'the impersonated user has no DocuSign accounts',
    })
  }
  const instanceUrl = accountApiBase(account, environment)
  if (!instanceUrl) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: USERINFO_STEP,
      environment,
      reason: 'account base_uri is not an eSignature host of this environment',
    })
  }

  if (options?.skipIdentity) {
    return { accessToken, expiresInSeconds, instanceUrl }
  }

  const resolvedAccountId = String(account.account_id).toLowerCase()
  const accountName =
    typeof account.account_name === 'string' && account.account_name
      ? account.account_name
      : undefined
  const userName = typeof userinfo.name === 'string' && userinfo.name ? userinfo.name : undefined
  const email = typeof userinfo.email === 'string' && userinfo.email ? userinfo.email : undefined
  const sub = typeof userinfo.sub === 'string' && userinfo.sub ? userinfo.sub : userId
  return {
    accessToken,
    expiresInSeconds,
    instanceUrl,
    identity: {
      displayName:
        [userName ?? email, accountName].filter(Boolean).join(' · ') ||
        `DocuSign ${resolvedAccountId}`,
      principal: userPrincipal(sub, email),
      auditMetadata: { docusignAccountId: resolvedAccountId, docusignEnvironment: environment },
      storedMetadata: { accountId: resolvedAccountId, environment, apiBase: instanceUrl },
    },
  }
}
