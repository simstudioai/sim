import { createHash } from 'node:crypto'
import { isRecordLike } from '@sim/utils/object'
import type { OAuth2Tokens } from 'better-auth/oauth2'
import type { GenericOAuthConfig } from 'better-auth/plugins'
import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'
import { verifyGitHubRepositoriesIdentity } from '@/lib/oauth/github-repositories'
import { deriveMicrosoftEmailVerified, mapMicrosoftProfileToUser } from '@/lib/oauth/microsoft'
import { SALESFORCE_LOGIN_HOSTS } from '@/lib/oauth/salesforce'
import { isTerminalRefreshError } from '@/lib/oauth/terminal-errors'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { MONDAY_API_URL, MONDAY_API_VERSION } from '@/tools/monday/utils'

const GOOGLE_OPENID_SCOPE = 'openid'
const GOOGLE_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
const GOOGLE_PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.profile'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels'
const ATLASSIAN_USER_INFO_URL = 'https://api.atlassian.com/me'
const ATLASSIAN_USER_INFO_MAX_BYTES = 256 * 1024
const ATLASSIAN_USER_INFO_TIMEOUT_MS = 10_000
const MICROSOFT_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
const MICROSOFT_OIDC_USER_INFO_URL = 'https://graph.microsoft.com/oidc/userinfo'
const MICROSOFT_OIDC_USER_INFO_MAX_BYTES = 256 * 1024
const MICROSOFT_OIDC_USER_INFO_TIMEOUT_MS = 10_000
const MICROSOFT_GRAPH_SCOPE_PREFIX = 'https://graph.microsoft.com/'
/** The Microsoft providers whose accounts a Credential Group can collect per person. */
const MICROSOFT_MANAGED_OAUTH_PROVIDER_IDS = new Set([
  'microsoft-teams',
  'outlook',
  'onedrive',
  'sharepoint',
  'microsoft-excel',
])

type AtlassianManagedOAuthProviderId = 'confluence' | 'jira'

export interface ManagedOAuthConnectorIdentity {
  providerSubjectId: string
  providerTenantId: string | null
  email: string
  emailVerified: boolean
  displayName?: string
  avatarUrl?: string
  nonce?: string
  grantedScopes: string[]
}

export interface ManagedOAuthConnectorConfig {
  additionalScopes: string[]
  requiresRefreshToken: boolean
  pkce: boolean
  /**
   * Set when the provider takes no scopes at all (Notion, ClickUp, Cal.com all authorize with an
   * empty scope list). Without it the empty scope policy is indistinguishable from a
   * misconfigured connector, which is what the policy guard exists to catch.
   */
  scopeless?: boolean
  nonceVerification: 'id_token' | 'state_only'
  includeLoginHint: boolean
  prompt?: string
  authorizationUrlParams?: Record<string, string>
  getAuthorizationAppId(clientId: string): string
  verifyIdentity(params: {
    tokens: OAuth2Tokens
    clientId: string
    expectedEmail?: string
  }): Promise<ManagedOAuthConnectorIdentity>
  hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean
  isTerminalRefreshError(errorCode: string | undefined): boolean
}

export interface ConnectorProviderConfig extends GenericOAuthConfig {
  managedOAuth: ManagedOAuthConnectorConfig
}

function canonicalGoogleScope(scope: string): string {
  if (scope === 'email') return GOOGLE_EMAIL_SCOPE
  if (scope === 'profile') return GOOGLE_PROFILE_SCOPE
  return scope
}

function hasRequiredGoogleScopes(
  providerId: string,
  grantedScopes: string[],
  requiredScopes: string[]
): boolean {
  const granted = new Set(grantedScopes.map(canonicalGoogleScope))
  return requiredScopes.every((requestedScope) => {
    const required = canonicalGoogleScope(requestedScope)
    if (granted.has(required)) return true
    return (
      providerId === 'google-email' &&
      granted.has(GMAIL_MODIFY_SCOPE) &&
      (required === GMAIL_READONLY_SCOPE ||
        required === GMAIL_SEND_SCOPE ||
        required === GMAIL_LABELS_SCOPE)
    )
  })
}

function requireVerifiedGooglePayload(payload: TokenPayload | undefined): TokenPayload & {
  sub: string
  email: string
} {
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google returned an invalid identity token')
  }
  return payload as TokenPayload & { sub: string; email: string }
}

export function createGoogleManagedOAuthConnector(providerId: string): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [GOOGLE_OPENID_SCOPE],
    requiresRefreshToken: true,
    pkce: true,
    nonceVerification: 'id_token',
    includeLoginHint: true,
    prompt: 'consent select_account',
    authorizationUrlParams: { include_granted_scopes: 'false' },
    getAuthorizationAppId(clientId) {
      return `google:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens, clientId }) {
      if (!tokens.idToken || !tokens.accessToken) {
        throw new Error('Google returned an incomplete authorization')
      }
      const client = new OAuth2Client({ clientId })
      const ticket = await client.verifyIdToken({ idToken: tokens.idToken, audience: clientId })
      const payload = requireVerifiedGooglePayload(ticket.getPayload())
      const tokenInfo = await client.getTokenInfo(tokens.accessToken)
      if (tokenInfo.aud !== clientId || tokenInfo.sub !== payload.sub) {
        throw new Error('Google returned an access token for another identity')
      }
      return {
        providerSubjectId: payload.sub,
        providerTenantId: payload.hd ?? null,
        email: payload.email,
        emailVerified: true,
        ...(payload.name ? { displayName: payload.name } : {}),
        ...(payload.picture ? { avatarUrl: payload.picture } : {}),
        ...(payload.nonce ? { nonce: payload.nonce } : {}),
        grantedScopes: [...new Set(tokenInfo.scopes)],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      return hasRequiredGoogleScopes(providerId, grantedScopes, requiredScopes)
    },
    isTerminalRefreshError(errorCode) {
      return errorCode === 'invalid_grant'
    },
  }
}

interface AtlassianUserProfile {
  account_type?: unknown
  account_id?: unknown
  email?: unknown
  name?: unknown
  picture?: unknown
  account_status?: unknown
}

function requireAtlassianUserProfile(value: AtlassianUserProfile): {
  accountId: string
  email: string
  name?: string
  picture?: string
} {
  if (
    value.account_type !== 'atlassian' ||
    typeof value.account_id !== 'string' ||
    !value.account_id.trim() ||
    typeof value.email !== 'string' ||
    !value.email.trim() ||
    value.account_status !== 'active'
  ) {
    throw new Error('Atlassian returned an invalid user identity')
  }
  return {
    accountId: value.account_id,
    email: value.email,
    ...(typeof value.name === 'string' && value.name ? { name: value.name } : {}),
    ...(typeof value.picture === 'string' && value.picture ? { picture: value.picture } : {}),
  }
}

/** Managed enrollment policy for Atlassian's Jira and Confluence 3LO clients. */
export function createAtlassianManagedOAuthConnector(
  providerId: AtlassianManagedOAuthProviderId
): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [],
    requiresRefreshToken: true,
    pkce: false,
    nonceVerification: 'state_only',
    includeLoginHint: false,
    prompt: 'consent',
    authorizationUrlParams: { audience: 'api.atlassian.com' },
    getAuthorizationAppId(clientId) {
      return `${providerId}:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens }) {
      if (!tokens.accessToken || !tokens.scopes?.length) {
        throw new Error('Atlassian returned an incomplete authorization')
      }
      const response = await fetch(ATLASSIAN_USER_INFO_URL, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        signal: AbortSignal.timeout(ATLASSIAN_USER_INFO_TIMEOUT_MS),
      })
      const profile = await readResponseJsonWithLimit<AtlassianUserProfile>(response, {
        maxBytes: ATLASSIAN_USER_INFO_MAX_BYTES,
        label: 'Atlassian user identity response',
      })
      if (!response.ok) {
        throw new Error(`Atlassian user identity request failed with HTTP ${response.status}`)
      }
      const identity = requireAtlassianUserProfile(profile)
      return {
        providerSubjectId: identity.accountId,
        providerTenantId: null,
        email: identity.email,
        emailVerified: true,
        ...(identity.name ? { displayName: identity.name } : {}),
        ...(identity.picture ? { avatarUrl: identity.picture } : {}),
        grantedScopes: [...new Set(tokens.scopes)],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes)
      return requiredScopes.every((scope) => granted.has(scope))
    },
    isTerminalRefreshError(errorCode) {
      return errorCode === 'invalid_grant' || errorCode === 'unauthorized_client'
    },
  }
}

let microsoftJwks: ReturnType<typeof createRemoteJWKSet> | undefined

/** The signing keys of the multi-tenant Microsoft identity platform, cached across verifications. */
function getMicrosoftJwks(): ReturnType<typeof createRemoteJWKSet> {
  microsoftJwks ??= createRemoteJWKSet(new URL(MICROSOFT_JWKS_URL))
  return microsoftJwks
}

/**
 * Graph delegated scopes compare by name regardless of case, and a token response may spell
 * one as its resource-qualified form.
 */
function canonicalMicrosoftScope(scope: string): string {
  const unqualified = scope.startsWith(MICROSOFT_GRAPH_SCOPE_PREFIX)
    ? scope.slice(MICROSOFT_GRAPH_SCOPE_PREFIX.length)
    : scope
  return unqualified.toLowerCase()
}

interface MicrosoftIdentityClaims {
  oid: string
  tid: string
  sub: string
  email: string
  name?: string
  nonce?: string
  claims: Record<string, unknown>
}

/**
 * Reads the claims a verified Microsoft id_token must carry to bind an enrollment. `oid` and
 * `tid` identify the person and their tenant stably across every Microsoft app; `sub` is the
 * app-pairwise subject the OIDC userinfo endpoint echoes back. The issuer is checked against the
 * token's own tenant because the multi-tenant `/common` authority signs for every tenant.
 */
function requireMicrosoftIdentityClaims(payload: JWTPayload): MicrosoftIdentityClaims {
  const claims: Record<string, unknown> = { ...payload }
  const { oid, tid, sub, iss, name, nonce } = claims
  if (
    typeof oid !== 'string' ||
    !oid ||
    typeof tid !== 'string' ||
    !tid ||
    typeof sub !== 'string' ||
    !sub ||
    iss !== `https://login.microsoftonline.com/${tid}/v2.0`
  ) {
    throw new Error('Microsoft returned an invalid identity token')
  }
  const email = [claims.email, claims.preferred_username, claims.upn].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  )
  if (!email) {
    throw new Error('Microsoft returned an identity token without an email')
  }
  return {
    oid,
    tid,
    sub,
    email,
    ...(typeof name === 'string' && name.trim() ? { name } : {}),
    ...(typeof nonce === 'string' && nonce ? { nonce } : {}),
    claims,
  }
}

/**
 * The subject the access token resolves to at Microsoft's OIDC userinfo endpoint. It needs only
 * the `openid` grant, so unlike Graph `/me` it does not fail for a tenant whose administrator has
 * not consented to Graph.
 */
async function fetchMicrosoftAccessTokenSubject(accessToken: string): Promise<string> {
  const response = await fetch(MICROSOFT_OIDC_USER_INFO_URL, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(MICROSOFT_OIDC_USER_INFO_TIMEOUT_MS),
  })
  const profile = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MICROSOFT_OIDC_USER_INFO_MAX_BYTES,
    label: 'Microsoft user identity response',
  })
  if (!response.ok) {
    throw new Error(`Microsoft user identity request failed with HTTP ${response.status}`)
  }
  if (!isRecordLike(profile) || typeof profile.sub !== 'string' || !profile.sub) {
    throw new Error('Microsoft returned an invalid user identity')
  }
  return profile.sub
}

/**
 * Managed enrollment policy for the providers that share Sim's Microsoft app registration.
 *
 * Identity comes from the id_token, verified against the identity platform's published keys and
 * bound to the access token through the OIDC userinfo subject, the way the Google policy binds
 * through tokeninfo. Microsoft never asserts `email_verified` for a work account, so the email
 * counts as proven only through the claims Entra does vouch for: the verified-email claims, or
 * `xms_edov` asserting the domain belongs to the account's own tenant.
 */
export function createMicrosoftManagedOAuthConnector(
  providerId: string
): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [],
    requiresRefreshToken: true,
    pkce: true,
    nonceVerification: 'id_token',
    includeLoginHint: true,
    prompt: 'select_account',
    getAuthorizationAppId(clientId) {
      return `microsoft:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens, clientId }) {
      if (!tokens.idToken || !tokens.accessToken) {
        throw new Error(`Microsoft ${providerId} returned an incomplete authorization`)
      }
      const { payload } = await jwtVerify(tokens.idToken, getMicrosoftJwks(), {
        audience: clientId,
      })
      const identity = requireMicrosoftIdentityClaims(payload)
      const accessTokenSubject = await fetchMicrosoftAccessTokenSubject(tokens.accessToken)
      if (accessTokenSubject !== identity.sub) {
        throw new Error('Microsoft returned an access token for another identity')
      }
      /**
       * The token response's `scope` is not guaranteed to echo the OIDC scopes or
       * `offline_access`, so each is counted only when the response itself proves the grant: an
       * id_token for `openid`, its `name` and `email` claims for `profile` and `email`, and a
       * refresh token for `offline_access`.
       */
      const grantedScopes = new Set(tokens.scopes ?? [])
      grantedScopes.add('openid')
      if (identity.name) grantedScopes.add('profile')
      if (typeof identity.claims.email === 'string') grantedScopes.add('email')
      if (tokens.refreshToken) grantedScopes.add('offline_access')
      return {
        providerSubjectId: identity.oid,
        providerTenantId: identity.tid,
        email: identity.email,
        emailVerified:
          deriveMicrosoftEmailVerified(identity.claims, identity.email) ||
          mapMicrosoftProfileToUser(identity.claims).emailVerified === true,
        ...(identity.name ? { displayName: identity.name } : {}),
        ...(identity.nonce ? { nonce: identity.nonce } : {}),
        grantedScopes: [...grantedScopes],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes.map(canonicalMicrosoftScope))
      return requiredScopes.every((scope) => granted.has(canonicalMicrosoftScope(scope)))
    },
    isTerminalRefreshError,
  }
}

const USER_INFO_TIMEOUT_MS = 10_000
const USER_INFO_MAX_BYTES = 256 * 1024

/**
 * Identity a provider's own profile endpoint can establish. Deliberately narrower than
 * {@link ManagedOAuthConnectorIdentity}: `nonce` is meaningless outside an OIDC id_token, and
 * `grantedScopes` is recovered separately because most providers do not report it here.
 */
export interface ManagedOAuthProfileIdentity {
  providerSubjectId: string
  email: string
  emailVerified: boolean
  providerTenantId?: string | null
  displayName?: string
  avatarUrl?: string
}

/**
 * How the granted scope list is recovered.
 *
 * Better Auth derives `tokens.scopes` from the token response's `scope` field and splits it on
 * spaces, so a provider that omits `scope` yields an empty list — and an empty granted list fails
 * the scope check on every provider that requires any scope, rejecting a grant the user actually
 * approved.
 *
 * - `token_response` — the provider reports `scope` on the token response. The honest default.
 * - `profile` — the scope list comes back on the identity response instead (DocuSign's
 *   `/oauth/userinfo`, HubSpot's token-introspection endpoint).
 * - `requested` — the provider reports scopes nowhere. Falls back to the scope set Sim asked for,
 *   which is sound only when the provider grants all-or-nothing and offers the user no way to
 *   deselect individual scopes at the consent screen. Verify that per provider before choosing it.
 */
export type ManagedOAuthScopeResolution =
  | { from: 'token_response' }
  | { from: 'profile'; read(profile: unknown, tokens: OAuth2Tokens): string[] }
  | { from: 'requested' }

export interface UserInfoManagedOAuthConnectorOptions {
  providerId: string
  userInfo: {
    /** A function when the access token belongs in the path rather than the header. */
    url: string | ((tokens: OAuth2Tokens) => string)
    method?: 'GET' | 'POST'
    headers?(accessToken: string): Record<string, string>
    /** Request body, for the providers whose identity lives behind a GraphQL query. */
    body?: string
  }
  /** Must throw when the response does not establish an identity — never invent a fallback. */
  parse(profile: unknown, tokens: OAuth2Tokens): ManagedOAuthProfileIdentity
  scopes: ManagedOAuthScopeResolution
  requiresRefreshToken: boolean
  pkce?: boolean
  scopeless?: boolean
  additionalScopes?: string[]
  prompt?: string
  authorizationUrlParams?: Record<string, string>
}

async function fetchManagedOAuthProfile(
  options: UserInfoManagedOAuthConnectorOptions,
  accessToken: string,
  tokens: OAuth2Tokens
): Promise<unknown> {
  const { providerId, userInfo } = options
  const url = typeof userInfo.url === 'function' ? userInfo.url(tokens) : userInfo.url
  const response = await fetch(url, {
    method: userInfo.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(userInfo.headers?.(accessToken) ?? { Authorization: `Bearer ${accessToken}` }),
    },
    ...(userInfo.body ? { body: userInfo.body } : {}),
    signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
  })
  const profile = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: USER_INFO_MAX_BYTES,
    label: `${providerId} user identity response`,
  })
  if (!response.ok) {
    throw new Error(`${providerId} user identity request failed with HTTP ${response.status}`)
  }
  return profile
}

function resolveGrantedScopes(
  options: UserInfoManagedOAuthConnectorOptions,
  profile: unknown,
  tokens: OAuth2Tokens
): string[] {
  switch (options.scopes.from) {
    case 'profile':
      return [...new Set(options.scopes.read(profile, tokens))]
    case 'requested':
      return [
        ...new Set([
          ...getCanonicalScopesForProvider(options.providerId),
          ...(options.additionalScopes ?? []),
        ]),
      ]
    default:
      return [...new Set(tokens.scopes ?? [])]
  }
}

/**
 * Managed enrollment policy for a provider whose identity comes from a plain profile endpoint
 * rather than an OIDC id_token.
 *
 * The matching `getUserInfo` in `connectors/providers.ts` is not reusable here even though it
 * calls the same endpoint: it exists to satisfy Better Auth's `email_is_missing` guard, so it
 * substitutes a synthetic address when the provider returns none and asserts `emailVerified: true`
 * in several places the provider never verified. Managed enrollment binds a credential to an
 * invited person, so `parse` must report only what the provider actually proves.
 */
export function createUserInfoManagedOAuthConnector(
  options: UserInfoManagedOAuthConnectorOptions
): ManagedOAuthConnectorConfig {
  const { providerId } = options
  return {
    additionalScopes: options.additionalScopes ?? [],
    requiresRefreshToken: options.requiresRefreshToken,
    pkce: options.pkce ?? false,
    nonceVerification: 'state_only',
    includeLoginHint: false,
    ...(options.scopeless ? { scopeless: true } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.authorizationUrlParams
      ? { authorizationUrlParams: options.authorizationUrlParams }
      : {}),
    getAuthorizationAppId(clientId) {
      return `${providerId}:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens }) {
      const accessToken = tokens.accessToken
      if (!accessToken) {
        throw new Error(`${providerId} returned an incomplete authorization`)
      }
      const profile = await fetchManagedOAuthProfile(options, accessToken, tokens)
      const identity = options.parse(profile, tokens)
      if (!identity.providerSubjectId.trim() || !identity.email.trim()) {
        throw new Error(`${providerId} returned an invalid user identity`)
      }
      return {
        providerSubjectId: identity.providerSubjectId,
        providerTenantId: identity.providerTenantId ?? null,
        email: identity.email,
        emailVerified: identity.emailVerified,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
        grantedScopes: resolveGrantedScopes(options, profile, tokens),
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes)
      return requiredScopes.every((scope) => granted.has(scope))
    },
    isTerminalRefreshError,
  }
}

function asProfileRecord(profile: unknown, providerName: string): Record<string, unknown> {
  if (!isRecordLike(profile)) {
    throw new Error(`${providerName} returned an invalid user identity`)
  }
  return profile
}

/** Reads a required identity field, accepting a numeric id as the string it stands for. */
function requireIdentityField(value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing from the provider's user identity`)
  }
  return value
}

function optionalIdentityField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function withOptionalIdentityFields(
  identity: ManagedOAuthProfileIdentity,
  fields: { displayName?: unknown; avatarUrl?: unknown; providerTenantId?: unknown }
): ManagedOAuthProfileIdentity {
  const displayName = optionalIdentityField(fields.displayName)
  const avatarUrl = optionalIdentityField(fields.avatarUrl)
  const providerTenantId =
    typeof fields.providerTenantId === 'number' && Number.isFinite(fields.providerTenantId)
      ? String(fields.providerTenantId)
      : optionalIdentityField(fields.providerTenantId)
  return {
    ...identity,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(providerTenantId ? { providerTenantId } : {}),
  }
}

/**
 * Unwraps a GraphQL identity response, treating a partial success as a failure: a `data` payload
 * accompanied by `errors` means the provider could not answer the whole query, and the fields it
 * did return are not a complete identity.
 */
function readGraphQLIdentity(
  profile: unknown,
  path: string,
  providerName: string
): Record<string, unknown> {
  const envelope = asProfileRecord(profile, providerName)
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    throw new Error(`${providerName} returned an invalid user identity`)
  }
  const data = asProfileRecord(envelope.data, providerName)
  return asProfileRecord(data[path], providerName)
}

/** Splits a provider's space-delimited `scope` string, tolerating its absence. */
function readScopeString(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

/**
 * Salesforce registers one connector per authorization server, so the userinfo host has to follow
 * the provider id rather than being fixed.
 */
function createSalesforceManagedOAuthConnector(providerId: string): ManagedOAuthConnectorConfig {
  const loginHost = SALESFORCE_LOGIN_HOSTS[providerId]
  if (!loginHost) {
    throw new Error(`Unknown Salesforce authorization server: ${providerId}`)
  }
  return createUserInfoManagedOAuthConnector({
    providerId,
    pkce: true,
    requiresRefreshToken: true,
    scopes: { from: 'token_response' },
    userInfo: { url: `https://${loginHost}/services/oauth2/userinfo` },
    parse: (profile) => {
      const user = asProfileRecord(profile, 'Salesforce')
      return withOptionalIdentityFields(
        {
          providerSubjectId: requireIdentityField(user.user_id ?? user.sub, 'Salesforce user id'),
          email: requireIdentityField(user.email, 'Salesforce email'),
          emailVerified: user.email_verified === true,
        },
        { displayName: user.name, avatarUrl: user.picture, providerTenantId: user.organization_id }
      )
    },
  })
}

/**
 * Attio's identity takes two calls: `/v2/self` names the member who authorized the token, and only
 * the member record carries their email. Listing members instead would return them in no defined
 * order, recording a stranger as the account's subject.
 */
function createAttioManagedOAuthConnector(): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [],
    requiresRefreshToken: false,
    pkce: false,
    nonceVerification: 'state_only',
    includeLoginHint: false,
    getAuthorizationAppId(clientId) {
      return `attio:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens }) {
      if (!tokens.accessToken) {
        throw new Error('Attio returned an incomplete authorization')
      }
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      }
      const selfResponse = await fetch('https://api.attio.com/v2/self', {
        headers,
        signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
      })
      const self = await readResponseJsonWithLimit<unknown>(selfResponse, {
        maxBytes: USER_INFO_MAX_BYTES,
        label: 'Attio identity response',
      })
      if (!selfResponse.ok) {
        throw new Error(`Attio identity request failed with HTTP ${selfResponse.status}`)
      }
      const identity = asProfileRecord(self, 'Attio')
      const memberId = requireIdentityField(
        identity.authorized_by_workspace_member_id,
        'Attio workspace member id'
      )
      const memberResponse = await fetch(
        `https://api.attio.com/v2/workspace_members/${encodeURIComponent(memberId)}`,
        { headers, signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS) }
      )
      const memberBody = await readResponseJsonWithLimit<unknown>(memberResponse, {
        maxBytes: USER_INFO_MAX_BYTES,
        label: 'Attio workspace member response',
      })
      if (!memberResponse.ok) {
        throw new Error(`Attio workspace member request failed with HTTP ${memberResponse.status}`)
      }
      const member = asProfileRecord(asProfileRecord(memberBody, 'Attio').data, 'Attio')
      const name = `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim()
      const base = withOptionalIdentityFields(
        {
          providerSubjectId: memberId,
          email: requireIdentityField(member.email_address, 'Attio email'),
          /** An Attio workspace member is only created by accepting a mailed invitation. */
          emailVerified: true,
        },
        { displayName: name, avatarUrl: member.avatar_url, providerTenantId: identity.workspace_id }
      )
      /**
       * Attio's token response omits `scope`, and its scope set is fixed by the OAuth app rather
       * than chosen at consent, so the requested set is what was granted.
       */
      const grantedScopes = tokens.scopes?.length
        ? tokens.scopes
        : getCanonicalScopesForProvider('attio')
      return {
        ...base,
        providerTenantId: base.providerTenantId ?? null,
        grantedScopes: [...new Set(grantedScopes)],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes)
      return requiredScopes.every((scope) => granted.has(scope))
    },
    isTerminalRefreshError,
  }
}

const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0'
const BITBUCKET_EMAIL_SCOPE = 'email'

/**
 * Bitbucket's current-user endpoint carries no address, and its emails endpoint needs the
 * `email` scope the consumer would not otherwise request; so this policy adds that scope and
 * reads the two resources in turn. The subject is the immutable `account_id`; there is no
 * tenant because one Bitbucket account belongs to any number of workspaces.
 */
function createBitbucketManagedOAuthConnector(): ManagedOAuthConnectorConfig {
  return {
    additionalScopes: [BITBUCKET_EMAIL_SCOPE],
    requiresRefreshToken: true,
    pkce: false,
    nonceVerification: 'state_only',
    includeLoginHint: false,
    getAuthorizationAppId(clientId) {
      return `bitbucket:${createHash('sha256').update(clientId).digest('hex')}`
    },
    async verifyIdentity({ tokens }) {
      if (!tokens.accessToken) {
        throw new Error('Bitbucket returned an incomplete authorization')
      }
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      }
      const userResponse = await fetch(`${BITBUCKET_API_BASE}/user`, {
        headers,
        signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
      })
      const userBody = await readResponseJsonWithLimit<unknown>(userResponse, {
        maxBytes: USER_INFO_MAX_BYTES,
        label: 'Bitbucket identity response',
      })
      if (!userResponse.ok) {
        throw new Error(`Bitbucket identity request failed with HTTP ${userResponse.status}`)
      }
      const user = asProfileRecord(userBody, 'Bitbucket')
      const accountId = requireIdentityField(user.account_id, 'Bitbucket account id')
      const emailsResponse = await fetch(`${BITBUCKET_API_BASE}/user/emails`, {
        headers,
        signal: AbortSignal.timeout(USER_INFO_TIMEOUT_MS),
      })
      const emailsBody = await readResponseJsonWithLimit<unknown>(emailsResponse, {
        maxBytes: USER_INFO_MAX_BYTES,
        label: 'Bitbucket emails response',
      })
      if (!emailsResponse.ok) {
        throw new Error(`Bitbucket emails request failed with HTTP ${emailsResponse.status}`)
      }
      const emails = asProfileRecord(emailsBody, 'Bitbucket').values
      const primary = Array.isArray(emails)
        ? emails.find(
            (entry): entry is Record<string, unknown> =>
              isRecordLike(entry) && entry.is_primary === true && entry.is_confirmed === true
          )
        : undefined
      const avatar =
        isRecordLike(user.links) && isRecordLike(user.links.avatar)
          ? user.links.avatar.href
          : undefined
      const base = withOptionalIdentityFields(
        {
          providerSubjectId: accountId,
          email: requireIdentityField(primary?.email, 'Bitbucket confirmed primary email'),
          /** Only a confirmed primary address is accepted above. */
          emailVerified: true,
        },
        { displayName: user.display_name, avatarUrl: avatar }
      )
      return {
        ...base,
        providerTenantId: null,
        /** Bitbucket reports the consumer's granted scopes on the token response. */
        grantedScopes: [...new Set(tokens.scopes ?? [])],
      }
    },
    hasRequiredScopes(grantedScopes, requiredScopes) {
      const granted = new Set(grantedScopes)
      return requiredScopes.every((scope) => granted.has(scope))
    },
    isTerminalRefreshError,
  }
}

/**
 * Managed enrollment policies for the providers whose identity endpoint reports an email the
 * provider itself vouches for. Keyed by connector provider id.
 *
 * A `Map` rather than an object literal so a provider id that collides with an `Object.prototype`
 * member cannot resolve to an inherited function and be invoked as a policy builder.
 */
const USER_INFO_MANAGED_OAUTH_CONNECTORS = new Map<string, () => ManagedOAuthConnectorConfig>([
  [
    'dropbox',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'dropbox',
        pkce: true,
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: {
          url: 'https://api.dropboxapi.com/2/users/get_current_account',
          method: 'POST',
        },
        parse: (profile) => {
          const account = asProfileRecord(profile, 'Dropbox')
          const name = isRecordLike(account.name) ? account.name : {}
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(account.account_id, 'Dropbox account id'),
              email: requireIdentityField(account.email, 'Dropbox email'),
              emailVerified: account.email_verified === true,
            },
            { displayName: name.display_name, avatarUrl: account.profile_photo_url }
          )
        },
      }),
  ],
  [
    'zoom',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'zoom',
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: { url: 'https://api.zoom.us/v2/users/me' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'Zoom')
          const displayName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Zoom user id'),
              email: requireIdentityField(user.email, 'Zoom email'),
              /** Zoom reports `1` for an activated, email-confirmed account. */
              emailVerified: user.verified === 1,
            },
            { displayName, avatarUrl: user.pic_url, providerTenantId: user.account_id }
          )
        },
      }),
  ],
  ['salesforce', () => createSalesforceManagedOAuthConnector('salesforce')],
  [
    'notion',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'notion',
        /** Notion authorizes without scopes and its integration tokens do not expire. */
        scopeless: true,
        requiresRefreshToken: false,
        scopes: { from: 'token_response' },
        userInfo: {
          url: 'https://api.notion.com/v1/users/me',
          headers: (accessToken) => ({
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': '2022-06-28',
          }),
        },
        parse: (profile) => {
          const self = asProfileRecord(profile, 'Notion')
          /**
           * An integration token always resolves to a bot, so the human is reachable only through
           * `bot.owner.user`. A workspace-owned internal integration reports
           * `{ type: 'workspace' }` and identifies nobody, which cannot be bound to an invitation.
           */
          const bot = isRecordLike(self.bot) ? self.bot : {}
          const owner = isRecordLike(bot.owner) ? bot.owner : {}
          if (owner.type !== 'user') {
            throw new Error(
              'Notion returned a workspace-owned integration, which identifies no person to bind this invitation to'
            )
          }
          const user = asProfileRecord(owner.user, 'Notion')
          const person = isRecordLike(user.person) ? user.person : {}
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Notion user id'),
              email: requireIdentityField(person.email, 'Notion email'),
              /** Notion only exposes `person.email` for a confirmed workspace member. */
              emailVerified: true,
            },
            { displayName: user.name, avatarUrl: user.avatar_url }
          )
        },
      }),
  ],
  [
    'clickup',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'clickup',
        /** ClickUp authorizes without scopes and its access tokens do not expire. */
        scopeless: true,
        requiresRefreshToken: false,
        scopes: { from: 'token_response' },
        userInfo: { url: 'https://api.clickup.com/api/v2/user' },
        parse: (profile) => {
          const envelope = asProfileRecord(profile, 'ClickUp')
          const user = asProfileRecord(envelope.user, 'ClickUp')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'ClickUp user id'),
              email: requireIdentityField(user.email, 'ClickUp email'),
              /** A ClickUp seat is only activated by confirming a mailed invitation. */
              emailVerified: true,
            },
            { displayName: user.username, avatarUrl: user.profilePicture }
          )
        },
      }),
  ],
  [
    'calcom',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'calcom',
        /** Cal.com's OAuth app authorizes without a scope list. */
        scopeless: true,
        pkce: true,
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: {
          url: 'https://api.cal.com/v2/me',
          headers: (accessToken) => ({
            Authorization: `Bearer ${accessToken}`,
            'cal-api-version': '2024-08-13',
          }),
        },
        parse: (profile) => {
          const envelope = asProfileRecord(profile, 'Cal.com')
          const user = asProfileRecord(envelope.data ?? envelope, 'Cal.com')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Cal.com user id'),
              email: requireIdentityField(user.email, 'Cal.com email'),
              /** A Cal.com account is only usable once its address has confirmed signup. */
              emailVerified: true,
            },
            { displayName: user.name, avatarUrl: user.avatarUrl }
          )
        },
      }),
  ],
  ['attio', createAttioManagedOAuthConnector],
  ['bitbucket', createBitbucketManagedOAuthConnector],
  [
    'github-repositories',
    () => ({
      additionalScopes: [],
      requiresRefreshToken: true,
      pkce: true,
      scopeless: true,
      nonceVerification: 'state_only',
      includeLoginHint: false,
      getAuthorizationAppId(clientId) {
        return `github-repositories:${createHash('sha256').update(clientId).digest('hex')}`
      },
      verifyIdentity({ tokens, expectedEmail }) {
        return verifyGitHubRepositoriesIdentity(tokens.accessToken ?? '', expectedEmail)
      },
      hasRequiredScopes(_grantedScopes, requiredScopes) {
        return requiredScopes.length === 0
      },
      isTerminalRefreshError(errorCode) {
        return isTerminalRefreshError(errorCode)
      },
    }),
  ],
  [
    'hubspot',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'hubspot',
        requiresRefreshToken: true,
        /**
         * HubSpot reports neither identity nor scopes on the token response. Its token-metadata
         * endpoint carries both, so one call answers each.
         */
        scopes: {
          from: 'profile',
          read: (profile) => {
            const metadata = isRecordLike(profile) ? profile : {}
            if (Array.isArray(metadata.scopes)) {
              return metadata.scopes.filter((scope): scope is string => typeof scope === 'string')
            }
            return readScopeString(metadata.scope)
          },
        },
        userInfo: {
          /** The token identifies itself: it is the path, and the endpoint takes no credential. */
          url: (tokens) =>
            `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(
              tokens.accessToken ?? ''
            )}`,
          headers: () => ({}),
        },
        parse: (profile) => {
          const metadata = asProfileRecord(profile, 'HubSpot')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(metadata.user_id, 'HubSpot user id'),
              /** HubSpot reports the authorizing seat's address as `user`. */
              email: requireIdentityField(metadata.user, 'HubSpot user email'),
              /** A HubSpot seat is only activated by confirming a mailed invitation. */
              emailVerified: true,
            },
            { providerTenantId: metadata.hub_id }
          )
        },
      }),
  ],
  [
    'linear',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'linear',
        pkce: true,
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: {
          url: 'https://api.linear.app/graphql',
          method: 'POST',
          headers: (accessToken) => ({
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ query: '{ viewer { id email name avatarUrl } }' }),
        },
        parse: (profile) => {
          const viewer = readGraphQLIdentity(profile, 'viewer', 'Linear')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(viewer.id, 'Linear user id'),
              email: requireIdentityField(viewer.email, 'Linear email'),
              /** A Linear account only exists once its address has accepted a mailed invite. */
              emailVerified: true,
            },
            { displayName: viewer.name, avatarUrl: viewer.avatarUrl }
          )
        },
      }),
  ],
  [
    'monday',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'monday',
        requiresRefreshToken: true,
        pkce: true,
        scopes: { from: 'token_response' },
        userInfo: {
          url: MONDAY_API_URL,
          method: 'POST',
          headers: (accessToken) => ({
            Authorization: accessToken,
            'Content-Type': 'application/json',
            'API-Version': MONDAY_API_VERSION,
          }),
          body: JSON.stringify({ query: '{ me { id name email } }' }),
        },
        parse: (profile) => {
          const user = readGraphQLIdentity(profile, 'me', 'monday.com')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'monday.com user id'),
              email: requireIdentityField(user.email, 'monday.com email'),
              /** monday.com activates a seat only after its address confirms the invitation. */
              emailVerified: true,
            },
            { displayName: user.name }
          )
        },
      }),
  ],
  [
    'box',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'box',
        requiresRefreshToken: true,
        /**
         * Box's token response reports `restricted_to`, never `scope`, and the scope set is fixed
         * by the Box app registration rather than chosen at consent — so the requested set is the
         * granted set, and reading the token response would fail every enrollment on an empty list.
         */
        scopes: { from: 'requested' },
        userInfo: { url: 'https://api.box.com/2.0/users/me' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'Box')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Box user id'),
              /** Box's `login` is the account's confirmed sign-in address. */
              email: requireIdentityField(user.login, 'Box login'),
              emailVerified: user.status === 'active',
            },
            { displayName: user.name, avatarUrl: user.avatar_url }
          )
        },
      }),
  ],
  [
    'asana',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'asana',
        requiresRefreshToken: true,
        scopes: { from: 'requested' },
        userInfo: { url: 'https://app.asana.com/api/1.0/users/me' },
        parse: (profile) => {
          const envelope = asProfileRecord(profile, 'Asana')
          const user = asProfileRecord(envelope.data, 'Asana')
          const photo = isRecordLike(user.photo) ? user.photo : {}
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.gid, 'Asana user id'),
              email: requireIdentityField(user.email, 'Asana email'),
              /** An Asana account is only usable once its address has confirmed the invitation. */
              emailVerified: true,
            },
            { displayName: user.name, avatarUrl: photo.image_128x128 }
          )
        },
      }),
  ],
  [
    'airtable',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'airtable',
        pkce: true,
        requiresRefreshToken: true,
        /** Airtable's `whoami` reports the token's own scopes; the token response does not. */
        scopes: {
          from: 'profile',
          read: (profile, tokens) => {
            const granted =
              isRecordLike(profile) && Array.isArray(profile.scopes)
                ? profile.scopes.filter((scope): scope is string => typeof scope === 'string')
                : []
            return granted.length ? granted : (tokens.scopes ?? [])
          },
        },
        userInfo: { url: 'https://api.airtable.com/v0/meta/whoami' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'Airtable')
          return {
            providerSubjectId: requireIdentityField(user.id, 'Airtable user id'),
            email: requireIdentityField(user.email, 'Airtable email'),
            /** Airtable only returns `email` once the address has been confirmed. */
            emailVerified: true,
          }
        },
      }),
  ],
  [
    'linkedin',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'linkedin',
        requiresRefreshToken: false,
        scopes: { from: 'token_response' },
        userInfo: { url: 'https://api.linkedin.com/v2/userinfo' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'LinkedIn')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.sub, 'LinkedIn subject id'),
              email: requireIdentityField(user.email, 'LinkedIn email'),
              /**
               * The OIDC claim, not a constant. The connector-layer `getUserInfo` asserts `true`
               * unconditionally, which would let an unverified address satisfy an invitation.
               */
              emailVerified: user.email_verified === true || user.email_verified === 'true',
            },
            { displayName: user.name, avatarUrl: user.picture }
          )
        },
      }),
  ],
  [
    'pipedrive',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'pipedrive',
        requiresRefreshToken: true,
        scopes: { from: 'token_response' },
        userInfo: { url: 'https://api.pipedrive.com/v1/users/me' },
        parse: (profile) => {
          const envelope = asProfileRecord(profile, 'Pipedrive')
          const user = asProfileRecord(envelope.data, 'Pipedrive')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.id, 'Pipedrive user id'),
              email: requireIdentityField(user.email, 'Pipedrive email'),
              /** Pipedrive activates a seat only once its invitation email is accepted. */
              emailVerified: user.activated === true,
            },
            { displayName: user.name, avatarUrl: user.icon_url, providerTenantId: user.company_id }
          )
        },
      }),
  ],
  [
    'wordpress',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'wordpress',
        /** WordPress.com issues long-lived tokens and no refresh token. */
        requiresRefreshToken: false,
        /**
         * WordPress.com's only scope is `global`, granted whole or not at all, so the requested set
         * is the granted set and there is nothing a consent screen could downgrade.
         */
        scopes: { from: 'requested' },
        userInfo: { url: 'https://public-api.wordpress.com/rest/v1.1/me' },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'WordPress.com')
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.ID ?? user.id, 'WordPress.com user id'),
              email: requireIdentityField(user.email, 'WordPress.com email'),
              emailVerified: user.email_verified === true,
            },
            { displayName: user.display_name ?? user.username, avatarUrl: user.avatar_URL }
          )
        },
      }),
  ],
  [
    'docusign',
    () =>
      createUserInfoManagedOAuthConnector({
        providerId: 'docusign',
        requiresRefreshToken: true,
        /** DocuSign reports the granted scopes on userinfo, not on the token response. */
        scopes: {
          from: 'profile',
          read: (profile, tokens) => {
            const granted = isRecordLike(profile) ? readScopeString(profile.scope) : []
            return granted.length ? granted : (tokens.scopes ?? [])
          },
        },
        userInfo: { url: getDocusignOAuthUrl('/oauth/userinfo') },
        parse: (profile) => {
          const user = asProfileRecord(profile, 'DocuSign')
          const accounts = Array.isArray(user.accounts) ? user.accounts.filter(isRecordLike) : []
          const defaultAccount =
            accounts.find((account) => account.is_default === true) ?? accounts[0]
          return withOptionalIdentityFields(
            {
              providerSubjectId: requireIdentityField(user.sub, 'DocuSign subject id'),
              email: requireIdentityField(user.email, 'DocuSign email'),
              /** A DocuSign account is only activated by following a link sent to this address. */
              emailVerified: true,
            },
            {
              displayName: user.name,
              providerTenantId: defaultAccount?.account_id,
            }
          )
        },
      }),
  ],
])

/**
 * The managed enrollment policy for a provider, without the surrounding connector. Separated from
 * {@link getManagedOAuthConnectorProviderConfig} so a policy can be inspected without a configured
 * OAuth client, which `buildConnectorProviders` requires.
 */
export function getManagedOAuthConnectorPolicy(
  providerId: string
): ManagedOAuthConnectorConfig | undefined {
  return resolveManagedOAuthPolicy(providerId)?.()
}

function resolveManagedOAuthPolicy(
  providerId: string
): (() => ManagedOAuthConnectorConfig) | undefined {
  if (
    providerId === 'google-email' ||
    providerId === 'google-calendar' ||
    providerId === 'google-drive' ||
    providerId === 'google-docs' ||
    providerId === 'google-forms' ||
    providerId === 'google-chat' ||
    providerId === 'google-meet' ||
    providerId === 'google-sheets'
  ) {
    return () => createGoogleManagedOAuthConnector(providerId)
  }
  if (providerId === 'confluence' || providerId === 'jira') {
    return () => createAtlassianManagedOAuthConnector(providerId)
  }
  if (MICROSOFT_MANAGED_OAUTH_PROVIDER_IDS.has(providerId)) {
    return () => createMicrosoftManagedOAuthConnector(providerId)
  }
  return USER_INFO_MANAGED_OAUTH_CONNECTORS.get(providerId)
}

export function getManagedOAuthConnectorProviderConfig(
  providerId: string
): ConnectorProviderConfig | undefined {
  const buildPolicy = resolveManagedOAuthPolicy(providerId)
  if (!buildPolicy) return undefined
  const connector = buildConnectorProviders().find(
    (candidate) => candidate.providerId === providerId
  )
  if (!connector) return undefined
  return { ...connector, managedOAuth: buildPolicy() }
}
