import { createSign } from 'crypto'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import { and, desc, eq } from 'drizzle-orm'
import { withLeaderLock } from '@/lib/concurrency/leader-lock'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { decryptSecret } from '@/lib/core/security/encryption'
import { isClientCredentialAccountProviderId } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  getClientCredentialAccountMinter,
  parseClientCredentialAccountSecretBlob,
} from '@/lib/credentials/client-credential-accounts/server'
import {
  getTokenServiceAccountDescriptor,
  isTokenServiceAccountProviderId,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  parseTokenServiceAccountSecretBlob,
  type TokenServiceAccountSecretBlob,
} from '@/lib/credentials/token-service-accounts/server'
import { refreshOAuthToken } from '@/lib/oauth'
import { OAuthRefreshError } from '@/lib/oauth/errors'
import { isInstagramProvider, shouldProactivelyRefreshInstagramToken } from '@/lib/oauth/instagram'
import {
  getMicrosoftRefreshTokenExpiry,
  isMicrosoftProvider,
  PROACTIVE_REFRESH_THRESHOLD_DAYS,
} from '@/lib/oauth/microsoft'
import {
  extractSlackTeamId,
  fanOutSlackTokenChain,
  getFreshestSlackChain,
  isSlackProvider,
} from '@/lib/oauth/slack'
import {
  getRecentTerminalError,
  isTerminalRefreshError,
  markCredentialDead,
} from '@/lib/oauth/terminal-errors'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'

const logger = createLogger('OAuthUtilsAPI')

export class ServiceAccountTokenError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorDescription: string
  ) {
    super(errorDescription)
    this.name = 'ServiceAccountTokenError'
  }
}

interface AccountInsertData {
  id: string
  userId: string
  providerId: string
  accountId: string
  accessToken: string
  scope: string
  createdAt: Date
  updatedAt: Date
  refreshToken?: string
  idToken?: string
  accessTokenExpiresAt?: Date
}

export interface ResolvedCredential {
  accountId: string
  workspaceId?: string
  usedCredentialTable: boolean
  credentialType?: string
  credentialId?: string
  providerId?: string
}

/**
 * Resolves a credential ID to its underlying account ID.
 * If `credentialId` matches a `credential` row, returns its `accountId` and `workspaceId`.
 * For service_account credentials, returns credentialId and type instead of accountId.
 * Otherwise assumes `credentialId` is already a raw `account.id` (legacy).
 */
export async function resolveOAuthAccountId(
  credentialId: string
): Promise<ResolvedCredential | null> {
  const [credentialRow] = await db
    .select({
      id: credential.id,
      type: credential.type,
      accountId: credential.accountId,
      workspaceId: credential.workspaceId,
      providerId: credential.providerId,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (credentialRow) {
    if (credentialRow.type === 'service_account') {
      return {
        accountId: '',
        credentialId: credentialRow.id,
        credentialType: 'service_account',
        workspaceId: credentialRow.workspaceId,
        providerId: credentialRow.providerId ?? undefined,
        usedCredentialTable: true,
      }
    }

    if (credentialRow.type !== 'oauth' || !credentialRow.accountId) {
      return null
    }
    return {
      accountId: credentialRow.accountId,
      workspaceId: credentialRow.workspaceId,
      usedCredentialTable: true,
    }
  }

  return { accountId: credentialId, usedCredentialTable: false }
}

/**
 * Userinfo scopes are excluded because service accounts don't represent a user
 * and cannot request user identity information. Google rejects token requests
 * that include these scopes for service account credentials.
 */
const SA_EXCLUDED_SCOPES = new Set([
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
])

/**
 * Generates a short-lived access token for a Google service account credential
 * using the two-legged OAuth JWT flow (RFC 7523).
 *
 * @param impersonateEmail - Optional. Required for Google Workspace APIs (Gmail, Drive, Calendar, etc.)
 *   where the service account must impersonate a domain user via domain-wide delegation.
 *   Not needed for project-scoped APIs like BigQuery or Vertex AI where the service account
 *   authenticates directly with its own IAM permissions.
 */
export async function getServiceAccountToken(
  credentialId: string,
  scopes: string[],
  impersonateEmail?: string
): Promise<string> {
  const [credentialRow] = await db
    .select({
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!credentialRow?.encryptedServiceAccountKey) {
    throw new Error('Service account key not found')
  }

  const { decrypted } = await decryptSecret(credentialRow.encryptedServiceAccountKey)
  const keyData = JSON.parse(decrypted) as {
    client_email: string
    private_key: string
    token_uri?: string
  }

  const filteredScopes = scopes.filter((s) => !SA_EXCLUDED_SCOPES.has(s))

  const now = Math.floor(Date.now() / 1000)
  const ALLOWED_TOKEN_URIS = new Set(['https://oauth2.googleapis.com/token'])
  const tokenUri =
    keyData.token_uri && ALLOWED_TOKEN_URIS.has(keyData.token_uri)
      ? keyData.token_uri
      : 'https://oauth2.googleapis.com/token'

  const header = { alg: 'RS256', typ: 'JWT' }
  const payload: Record<string, unknown> = {
    iss: keyData.client_email,
    scope: filteredScopes.join(' '),
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }

  if (impersonateEmail) {
    payload.sub = impersonateEmail
  }

  logger.info('Service account JWT payload', {
    iss: keyData.client_email,
    sub: impersonateEmail || '(none)',
    scopes: filteredScopes.join(' '),
    aud: tokenUri,
  })

  const toBase64Url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')

  const signingInput = `${toBase64Url(header)}.${toBase64Url(payload)}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(keyData.private_key, 'base64url')

  const jwt = `${signingInput}.${signature}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    logger.error('Service account token exchange failed', {
      status: response.status,
      body: errorBody,
    })
    let description = `Token exchange failed: ${response.status}`
    try {
      const parsed = JSON.parse(errorBody) as { error_description?: string }
      if (parsed.error_description) {
        const raw = parsed.error_description
        if (raw.includes('SignatureException') || raw.includes('Invalid signature')) {
          description = 'Invalid account credentials.'
        } else {
          description = raw
        }
      }
    } catch {
      // use default description
    }
    throw new ServiceAccountTokenError(response.status, description)
  }

  const tokenData = (await response.json()) as { access_token: string }
  return tokenData.access_token
}

export interface SlackBotCredentialSecrets {
  signingSecret: string
  botToken: string
  teamId: string
  botUserId?: string
  teamName?: string
  /** Owning workspace — callers with a user/workflow context must verify it. */
  workspaceId: string | null
}

/**
 * Decrypt a reusable custom Slack bot credential — a `service_account` credential
 * with `providerId='slack-custom-bot'` whose encrypted blob holds the bring-your-own
 * app's signing secret + bot token + derived team_id/bot_user_id. Returns null if
 * the id is not such a credential (or its blob is incomplete).
 *
 * @remarks Server-internal. The native custom ingest route authenticates each
 * request via the app's signing secret (not a user session), so this reader does
 * no per-user authorization; callers with a user context authorize separately.
 */
export async function getSlackBotCredential(
  credentialId: string
): Promise<SlackBotCredentialSecrets | null> {
  const [row] = await db
    .select({
      type: credential.type,
      providerId: credential.providerId,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
      workspaceId: credential.workspaceId,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (
    !row ||
    row.type !== 'service_account' ||
    row.providerId !== SLACK_CUSTOM_BOT_PROVIDER_ID ||
    !row.encryptedServiceAccountKey
  ) {
    return null
  }

  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  const blob = JSON.parse(decrypted) as Partial<SlackBotCredentialSecrets>
  if (!blob.signingSecret || !blob.botToken || !blob.teamId) {
    return null
  }
  return {
    signingSecret: blob.signingSecret,
    botToken: blob.botToken,
    teamId: blob.teamId,
    botUserId: blob.botUserId,
    teamName: blob.teamName,
    workspaceId: row.workspaceId ?? null,
  }
}

interface AtlassianServiceAccountSecret {
  type: typeof ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE
  apiToken: string
  domain: string
  cloudId: string
  atlassianAccountId?: string
}

/**
 * Loads the decrypted Atlassian service account secret blob for a credential.
 * Throws if the credential is missing or not an Atlassian service account.
 */
export async function getAtlassianServiceAccountSecret(
  credentialId: string
): Promise<AtlassianServiceAccountSecret> {
  const [credentialRow] = await db
    .select({ encryptedServiceAccountKey: credential.encryptedServiceAccountKey })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!credentialRow?.encryptedServiceAccountKey) {
    throw new Error('Atlassian service account secret not found')
  }

  const { decrypted } = await decryptSecret(credentialRow.encryptedServiceAccountKey)
  const parsed = JSON.parse(decrypted) as AtlassianServiceAccountSecret
  if (
    parsed.type !== ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE ||
    !parsed.apiToken ||
    !parsed.cloudId
  ) {
    throw new Error('Stored Atlassian service account secret is malformed')
  }
  return parsed
}

/**
 * Result of resolving a `service_account` credential into a usable token. For
 * Atlassian and the token-paste providers, the stored token IS the access
 * token — no exchange or refresh is needed; Google mints a short-lived token
 * via the JWT-bearer flow instead.
 */
export interface ServiceAccountTokenResult {
  accessToken: string
  /** Atlassian only — the resolved Jira/Confluence cloud id. */
  cloudId?: string
  /** Atlassian and domain-scoped token providers (e.g. Shopify) — the site/store domain. */
  domain?: string
  /** Salesforce only — the org's instance URL the token must be used against. */
  instanceUrl?: string
  /**
   * Set when the token must be sent in an `x-api-token` header instead of
   * `Authorization: Bearer` (e.g. Pipedrive personal API tokens). Absent means
   * Bearer; OAuth credentials never carry it.
   */
  authStyle?: 'x-api-token'
}

/**
 * Loads and parses the decrypted secret blob for a token service-account
 * credential (pasted long-lived provider token). Throws if the credential is
 * missing or the blob doesn't belong to the expected provider.
 */
async function getTokenServiceAccountSecret(
  credentialId: string,
  providerId: string
): Promise<TokenServiceAccountSecretBlob> {
  const [credentialRow] = await db
    .select({ encryptedServiceAccountKey: credential.encryptedServiceAccountKey })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)

  if (!credentialRow?.encryptedServiceAccountKey) {
    throw new Error('Token service account secret not found')
  }

  const { decrypted } = await decryptSecret(credentialRow.encryptedServiceAccountKey)
  return parseTokenServiceAccountSecretBlob(decrypted, providerId)
}

interface CachedClientCredentialToken {
  accessToken: string
  expiresAtMs: number
  /**
   * Fingerprint of the encrypted secret the token was minted from (see
   * {@link secretFingerprintOf}). A reconnect that re-points the credential at
   * different client credentials changes the ciphertext, so a mismatch means
   * the cached token belongs to the old app and must be re-minted.
   */
  secretFingerprint: string
  /** Salesforce only — the instance URL returned alongside the minted token. */
  instanceUrl?: string
}

interface FailedClientCredentialMint {
  /** The error the failed mint threw, re-thrown to callers while memoized. */
  error: unknown
  secretFingerprint: string
  expiresAtMs: number
}

/**
 * Per-instance cache of minted client-credential access tokens (Zoom S2S,
 * Box CCG, Salesforce client-credentials), keyed by credential id. Entries are
 * served while more than {@link CLIENT_CREDENTIAL_TOKEN_MIN_TTL_MS} of
 * validity remains, so a hot credential mints roughly once per token TTL
 * (~1h for Zoom/Box; Salesforce reports a conservative 10-minute TTL because
 * its responses never carry an expiry) per instance.
 *
 * Every resolution re-reads the credential row (a cheap indexed PK select —
 * the mint is the expensive part) and validates the cached entry's secret
 * fingerprint against the live ciphertext, so rotating or re-pointing a
 * credential takes effect on the next resolution on every instance, and a
 * credential that is re-resolved after deletion evicts its own entries. No
 * cross-instance lock is needed: mints are stateless and these providers allow
 * multiple concurrently valid tokens, so each instance minting its own token
 * is correct.
 *
 * Failed mints are never cached as tokens; instead they are memoized for
 * {@link CLIENT_CREDENTIAL_MINT_FAILURE_TTL_MS} so a hot workflow on a
 * revoked/invalid secret doesn't hammer the provider's token endpoint once
 * per block execution.
 *
 * Both maps are pruned of expired entries on each resolution
 * ({@link pruneExpiredClientCredentialCaches}), so their size is bounded by the
 * credentials resolved within the last token lifetime — entries for credentials
 * that are never resolved again do not accumulate indefinitely.
 */
const clientCredentialTokenCache = new Map<string, CachedClientCredentialToken>()
const clientCredentialMintFailureCache = new Map<string, FailedClientCredentialMint>()
const CLIENT_CREDENTIAL_TOKEN_MIN_TTL_MS = 5 * 60 * 1000
const CLIENT_CREDENTIAL_MINT_FAILURE_TTL_MS = 30 * 1000

/** Drops fully-expired token and failure entries so the maps stay bounded. */
function pruneExpiredClientCredentialCaches(nowMs: number): void {
  for (const [id, entry] of clientCredentialTokenCache) {
    if (entry.expiresAtMs <= nowMs) clientCredentialTokenCache.delete(id)
  }
  for (const [id, entry] of clientCredentialMintFailureCache) {
    if (entry.expiresAtMs <= nowMs) clientCredentialMintFailureCache.delete(id)
  }
}

/**
 * Rotation fingerprint for a stored encrypted secret: the ciphertext prefix
 * (IV + first blocks) is unique per encryption, so any re-encrypt — secret
 * rotation or re-pointing at a different app — changes it.
 */
function secretFingerprintOf(encryptedServiceAccountKey: string): string {
  return encryptedServiceAccountKey.slice(0, 32)
}

/**
 * Resolves a client-credential service-account credential to a short-lived
 * access token: decrypts the stored client id/secret + org id and mints via
 * the provider's registered minter (skipping the connect-time identity
 * lookup), read-through the per-instance cache. Wrapped in `coalesceLocally`
 * so concurrent block executions on one instance share a single mint.
 */
async function resolveClientCredentialAccountToken(
  credentialId: string,
  providerId: string
): Promise<ServiceAccountTokenResult> {
  return coalesceLocally(`ccsa:${credentialId}`, async () => {
    pruneExpiredClientCredentialCaches(Date.now())
    const [credentialRow] = await db
      .select({ encryptedServiceAccountKey: credential.encryptedServiceAccountKey })
      .from(credential)
      .where(eq(credential.id, credentialId))
      .limit(1)
    if (!credentialRow?.encryptedServiceAccountKey) {
      clientCredentialTokenCache.delete(credentialId)
      clientCredentialMintFailureCache.delete(credentialId)
      throw new Error('Client-credential service account secret not found')
    }
    const secretFingerprint = secretFingerprintOf(credentialRow.encryptedServiceAccountKey)

    const cached = clientCredentialTokenCache.get(credentialId)
    if (
      cached &&
      cached.secretFingerprint === secretFingerprint &&
      cached.expiresAtMs - Date.now() > CLIENT_CREDENTIAL_TOKEN_MIN_TTL_MS
    ) {
      return { accessToken: cached.accessToken, instanceUrl: cached.instanceUrl }
    }

    const failed = clientCredentialMintFailureCache.get(credentialId)
    if (
      failed &&
      failed.secretFingerprint === secretFingerprint &&
      Date.now() < failed.expiresAtMs
    ) {
      throw failed.error
    }
    clientCredentialMintFailureCache.delete(credentialId)

    try {
      const { decrypted } = await decryptSecret(credentialRow.encryptedServiceAccountKey)
      const blob = parseClientCredentialAccountSecretBlob(decrypted, providerId)
      const minter = getClientCredentialAccountMinter(providerId)
      if (!minter) {
        throw new Error(`No minter registered for service-account provider ${providerId}`)
      }

      const mint = await minter(
        {
          clientId: blob.clientId,
          clientSecret: blob.clientSecret,
          orgId: blob.orgId,
        },
        { skipIdentity: true }
      )
      clientCredentialTokenCache.set(credentialId, {
        accessToken: mint.accessToken,
        expiresAtMs: Date.now() + mint.expiresInSeconds * 1000,
        secretFingerprint,
        instanceUrl: mint.instanceUrl,
      })
      return { accessToken: mint.accessToken, instanceUrl: mint.instanceUrl }
    } catch (error) {
      clientCredentialMintFailureCache.set(credentialId, {
        error,
        secretFingerprint,
        expiresAtMs: Date.now() + CLIENT_CREDENTIAL_MINT_FAILURE_TTL_MS,
      })
      throw error
    }
  })
}

interface ServiceAccountTokenOptions {
  scopes?: string[]
  impersonateEmail?: string
}

type ServiceAccountTokenResolver = (
  credentialId: string,
  options: ServiceAccountTokenOptions
) => Promise<ServiceAccountTokenResult>

/**
 * Resolver registry for the bespoke service-account providers. Token-paste
 * providers (registered in `TOKEN_SERVICE_ACCOUNT_DESCRIPTORS`) resolve
 * generically: the stored token IS the access token.
 */
const SERVICE_ACCOUNT_TOKEN_RESOLVERS: Record<string, ServiceAccountTokenResolver> = {
  [ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID]: async (credentialId) => {
    const secret = await getAtlassianServiceAccountSecret(credentialId)
    return { accessToken: secret.apiToken, cloudId: secret.cloudId, domain: secret.domain }
  },
  [SLACK_CUSTOM_BOT_PROVIDER_ID]: async (credentialId) => {
    const botCredential = await getSlackBotCredential(credentialId)
    if (!botCredential) {
      throw new Error('Slack bot credential not found')
    }
    return { accessToken: botCredential.botToken }
  },
  [GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID]: async (credentialId, { scopes, impersonateEmail }) => {
    if (!scopes?.length) {
      throw new Error('Scopes are required for service account credentials')
    }
    return { accessToken: await getServiceAccountToken(credentialId, scopes, impersonateEmail) }
  },
}

/**
 * Single dispatch point for turning a `service_account` credential into an
 * access token, keyed on `providerId`. Both `refreshAccessTokenIfNeeded` and the
 * `POST /api/auth/oauth/token` route go through here, so a new service-account
 * provider is one registry entry and an unknown provider fails loudly instead
 * of silently attempting a Google JWT.
 */
export async function resolveServiceAccountToken(
  credentialId: string,
  providerId: string | null | undefined,
  scopes?: string[],
  impersonateEmail?: string
): Promise<ServiceAccountTokenResult> {
  if (providerId && isTokenServiceAccountProviderId(providerId)) {
    const secret = await getTokenServiceAccountSecret(credentialId, providerId)
    const descriptorAuthStyle = getTokenServiceAccountDescriptor(providerId)?.authStyle
    return {
      accessToken: secret.apiToken,
      domain: secret.domain,
      ...(descriptorAuthStyle === 'x-api-token' ? { authStyle: descriptorAuthStyle } : {}),
    }
  }
  if (providerId && isClientCredentialAccountProviderId(providerId)) {
    return resolveClientCredentialAccountToken(credentialId, providerId)
  }
  const resolver =
    providerId && Object.hasOwn(SERVICE_ACCOUNT_TOKEN_RESOLVERS, providerId)
      ? SERVICE_ACCOUNT_TOKEN_RESOLVERS[providerId]
      : undefined
  if (!resolver) {
    throw new Error(`Unsupported service-account provider: ${providerId ?? 'unknown'}`)
  }
  return resolver(credentialId, { scopes, impersonateEmail })
}

/**
 * Safely inserts an account record, handling duplicate constraint violations gracefully.
 * If a duplicate is detected (unique constraint violation), logs a warning and returns success.
 */
export async function safeAccountInsert(
  data: AccountInsertData,
  context: { provider: string; identifier?: string }
): Promise<void> {
  try {
    await db.insert(account).values(data)
    logger.info(`Created new ${context.provider} account for user`, { userId: data.userId })
  } catch (error: any) {
    if (getPostgresErrorCode(error) === '23505') {
      logger.error(`Duplicate ${context.provider} account detected, credential already exists`, {
        userId: data.userId,
        identifier: context.identifier,
      })
    } else {
      throw error
    }
  }
}

/**
 * Get a credential by resolved account ID and verify it belongs to the user.
 */
async function getCredentialByAccountId(requestId: string, accountId: string, userId: string) {
  const credentials = await db
    .select()
    .from(account)
    .where(and(eq(account.id, accountId), eq(account.userId, userId)))
    .limit(1)

  if (!credentials.length) {
    logger.warn(`[${requestId}] Credential not found`)
    return undefined
  }

  return {
    ...credentials[0],
    resolvedCredentialId: accountId,
  }
}

/**
 * Get a credential by ID and verify it belongs to the user.
 */
export async function getCredential(requestId: string, credentialId: string, userId: string) {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    logger.warn(`[${requestId}] Credential is not an OAuth credential`)
    return undefined
  }
  return getCredentialByAccountId(requestId, resolved.accountId, userId)
}

interface CoalescedRefreshOptions {
  accountId: string
  providerId: string
  refreshToken: string
  /** External provider account id (`account.accountId`), used to scope Slack refreshes per installation. */
  providerAccountId?: string | null
  requestId?: string
  userId?: string
}

interface CoalescedRefreshOutcome {
  accessToken: string | null
  /** Present when the refresh failed with a known provider error; absent on follower timeout / transient failure. */
  error?: OAuthRefreshError
}

/**
 * Slack lock budgets sized past `TOKEN_REFRESH_TIMEOUT_MS` (15s) in
 * lib/oauth/oauth.ts: installation-keyed locks make every sibling row's request
 * a follower of one refresh, so followers must keep polling for the leader's
 * full provider window and the lock must not expire under a live refresh.
 */
const SLACK_FOLLOWER_MAX_WAIT_MS = 16_000
const SLACK_LOCK_TTL_SEC = 20

async function performCoalescedRefresh({
  accountId,
  providerId,
  refreshToken,
  providerAccountId,
  requestId,
  userId,
}: CoalescedRefreshOptions): Promise<CoalescedRefreshOutcome> {
  /**
   * Slack bot tokens are per-installation (team × app): every account row for
   * one team holds a copy of the same rotating chain, so refreshes are locked,
   * dead-flagged, and written per installation rather than per row.
   */
  const slackTeamId = isSlackProvider(providerId) ? extractSlackTeamId(providerAccountId) : null
  const scopeKey = slackTeamId ? `slack:${slackTeamId}` : accountId

  const logContext = {
    ...(requestId ? { requestId } : {}),
    ...(userId ? { userId } : {}),
    ...(slackTeamId ? { slackTeamId } : {}),
    providerId,
    accountId,
  }

  const deadCode = await getRecentTerminalError(scopeKey)
  if (deadCode) {
    logger.warn('Skipping refresh: credential recently failed', {
      ...logContext,
      errorCode: deadCode,
    })
    return { accessToken: null, error: new OAuthRefreshError(providerId, deadCode) }
  }

  const lockKey = `oauth:refresh:${scopeKey}`

  const refreshPromise = coalesceLocally(lockKey, () =>
    withLeaderLock<CoalescedRefreshOutcome>({
      key: lockKey,
      // Installation-keyed Slack locks gather followers from every sibling row,
      // so their wait and the lock TTL must outlast the 15s provider timeout —
      // the 3s/10s defaults would fail followers early and let a second leader
      // start a concurrent rotation mid-refresh.
      ...(slackTeamId ? { maxWaitMs: SLACK_FOLLOWER_MAX_WAIT_MS, ttlSec: SLACK_LOCK_TTL_SEC } : {}),
      onLeader: async () => {
        try {
          let refreshTokenToUse = refreshToken
          if (slackTeamId) {
            const freshest = await getFreshestSlackChain(slackTeamId)
            if (!freshest) {
              throw new Error(
                `No refresh-capable account row found for Slack installation ${slackTeamId}`
              )
            }
            if (
              freshest.accessToken &&
              freshest.accessTokenExpiresAt &&
              freshest.accessTokenExpiresAt > new Date()
            ) {
              await fanOutSlackTokenChain(slackTeamId, {
                accessToken: freshest.accessToken,
                refreshToken: freshest.refreshToken,
                accessTokenExpiresAt: freshest.accessTokenExpiresAt,
              })
              logger.info('Reused freshest Slack installation token', logContext)
              return { accessToken: freshest.accessToken }
            }
            refreshTokenToUse = freshest.refreshToken
          }

          const result = await refreshOAuthToken(providerId, refreshTokenToUse)

          if (!result.ok) {
            logger.error('Failed to refresh token', {
              ...logContext,
              errorCode: result.errorCode,
            })
            if (result.errorCode && isTerminalRefreshError(result.errorCode)) {
              await markCredentialDead(scopeKey, result.errorCode)
            }
            return {
              accessToken: null,
              // No errorCode = transient (timeout/network), not a provider rejection —
              // stay errorless so callers keep their null-fallback behavior.
              ...(result.errorCode
                ? {
                    error: new OAuthRefreshError(
                      providerId,
                      result.errorCode,
                      result.errorDescription
                    ),
                  }
                : {}),
            }
          }

          const accessTokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000)

          if (slackTeamId) {
            await fanOutSlackTokenChain(slackTeamId, {
              accessToken: result.accessToken,
              refreshToken: result.refreshToken || refreshTokenToUse,
              accessTokenExpiresAt,
            })
          } else {
            const updateData: Record<string, unknown> = {
              accessToken: result.accessToken,
              accessTokenExpiresAt,
              updatedAt: new Date(),
            }
            if (result.refreshToken && result.refreshToken !== refreshToken) {
              updateData.refreshToken = result.refreshToken
            }
            if (isMicrosoftProvider(providerId)) {
              updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
            }

            await db.update(account).set(updateData).where(eq(account.id, accountId))
          }

          logger.info('Successfully refreshed access token', logContext)
          return { accessToken: result.accessToken }
        } catch (error) {
          logger.error('Refresh failed inside leader path', {
            ...logContext,
            error: toError(error).message,
          })
          return { accessToken: null }
        }
      },
      onFollower: async () => {
        try {
          const [row] = await db
            .select({
              accessToken: account.accessToken,
              accessTokenExpiresAt: account.accessTokenExpiresAt,
            })
            .from(account)
            .where(eq(account.id, accountId))
            .limit(1)
          if (
            row?.accessToken &&
            row.accessTokenExpiresAt &&
            row.accessTokenExpiresAt > new Date()
          ) {
            logger.info('Got fresh access token from coalesced refresh', logContext)
            return { accessToken: row.accessToken }
          }
          return null
        } catch (error) {
          logger.warn('Follower DB read failed during refresh poll', {
            ...logContext,
            error: toError(error).message,
          })
          return null
        }
      },
    })
  )

  try {
    return (await refreshPromise) ?? { accessToken: null }
  } catch (error) {
    logger.error('Coalesced refresh did not settle', {
      ...logContext,
      error: toError(error).message,
    })
    return { accessToken: null }
  }
}

export async function getOAuthToken(userId: string, providerId: string): Promise<string | null> {
  const connections = await db
    .select({
      id: account.id,
      providerAccountId: account.accountId,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      idToken: account.idToken,
      scope: account.scope,
      updatedAt: account.updatedAt,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .orderBy(desc(account.updatedAt))
    .limit(1)

  if (connections.length === 0) {
    logger.warn(`No OAuth token found for user ${userId}, provider ${providerId}`)
    return null
  }

  const credential = connections[0]

  // Determine whether we should refresh: missing/expired token, or Instagram
  // long-lived token nearing expiry (Meta cannot refresh after expiry).
  const now = new Date()
  const tokenExpiry = credential.accessTokenExpiresAt
  const accessTokenNeedsRefresh =
    !!credential.refreshToken && (!credential.accessToken || (tokenExpiry && tokenExpiry < now))
  const instagramNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isInstagramProvider(providerId) &&
    shouldProactivelyRefreshInstagramToken({
      accessTokenExpiresAt: credential.accessTokenExpiresAt,
      updatedAt: credential.updatedAt,
      now,
    })

  if (accessTokenNeedsRefresh || instagramNeedsProactiveRefresh) {
    const outcome = await performCoalescedRefresh({
      accountId: credential.id,
      providerId,
      refreshToken: credential.refreshToken!,
      providerAccountId: credential.providerAccountId,
      userId,
    })
    if (outcome.accessToken) return outcome.accessToken
    if (!accessTokenNeedsRefresh && credential.accessToken) {
      return credential.accessToken
    }
    if (outcome.error) throw outcome.error
    return null
  }

  if (!credential.accessToken) {
    logger.warn(
      `Access token is null and no refresh attempted or available for user ${userId}, provider ${providerId}`
    )
    return null
  }

  logger.info(`Found valid OAuth token for user ${userId}, provider ${providerId}`)
  return credential.accessToken
}

/**
 * Resolves a credential to its access token plus provider metadata
 * (`cloudId`/`domain`/`instanceUrl`/`authStyle`). Behaves exactly like
 * {@link refreshAccessTokenIfNeeded} but returns the full
 * {@link ServiceAccountTokenResult} so callers that build provider requests
 * directly (e.g. selector routes) can honor non-Bearer auth styles such as
 * Pipedrive's `x-api-token`. OAuth credentials resolve with `accessToken`
 * only.
 */
export async function resolveCredentialAccessToken(
  credentialId: string,
  userId: string,
  requestId: string,
  scopes?: string[],
  impersonateEmail?: string
): Promise<ServiceAccountTokenResult | null> {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    return null
  }

  if (resolved.credentialType === 'service_account' && resolved.credentialId) {
    logger.info(`[${requestId}] Using service account token for credential`)
    return resolveServiceAccountToken(
      resolved.credentialId,
      resolved.providerId,
      scopes,
      impersonateEmail
    )
  }

  // Use the already-resolved account ID to avoid a redundant resolveOAuthAccountId query
  const credential = await getCredentialByAccountId(requestId, resolved.accountId, userId)

  if (!credential) {
    return null
  }

  // Decide if we should refresh: token missing OR expired
  const accessTokenExpiresAt = credential.accessTokenExpiresAt
  const refreshTokenExpiresAt = credential.refreshTokenExpiresAt
  const now = new Date()

  // Check if access token needs refresh (missing or expired)
  const accessTokenNeedsRefresh =
    !!credential.refreshToken &&
    (!credential.accessToken || (accessTokenExpiresAt && accessTokenExpiresAt <= now))

  // Check if we should proactively refresh to prevent refresh token expiry
  // This applies to Microsoft providers whose refresh tokens expire after 90 days of inactivity
  const proactiveRefreshThreshold = new Date(
    now.getTime() + PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  const refreshTokenNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isMicrosoftProvider(credential.providerId) &&
    refreshTokenExpiresAt &&
    refreshTokenExpiresAt <= proactiveRefreshThreshold

  // Instagram long-lived tokens can only be refreshed while still valid.
  const instagramNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isInstagramProvider(credential.providerId) &&
    shouldProactivelyRefreshInstagramToken({
      accessTokenExpiresAt,
      updatedAt: credential.updatedAt,
      now,
    })

  const shouldRefresh =
    accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh || instagramNeedsProactiveRefresh

  const accessToken = credential.accessToken

  if (shouldRefresh) {
    const resolvedCredentialId =
      (credential as { resolvedCredentialId?: string }).resolvedCredentialId ?? credentialId

    const outcome = await performCoalescedRefresh({
      accountId: resolvedCredentialId,
      providerId: credential.providerId,
      refreshToken: credential.refreshToken!,
      providerAccountId: credential.accountId,
      requestId,
      userId: credential.userId,
    })
    if (outcome.accessToken) return { accessToken: outcome.accessToken }

    // If refresh was only triggered proactively (Microsoft refresh-token aging /
    // Instagram long-lived nearing expiry), the still-valid access token is fine.
    if (!accessTokenNeedsRefresh && accessToken) {
      logger.info(`[${requestId}] Refresh unavailable; reusing still-valid access token`)
      return { accessToken }
    }
    return null
  }
  if (!accessToken) {
    // We have no access token and either no refresh token or not eligible to refresh
    logger.error(`[${requestId}] Missing access token for credential`)
    return null
  }

  logger.info(`[${requestId}] Access token is valid for credential`)
  return { accessToken }
}

/**
 * Refreshes an OAuth token if needed based on credential information.
 * Also handles service account credentials by generating a JWT-based token.
 * Thin string wrapper over {@link resolveCredentialAccessToken}.
 * @param credentialId The ID of the credential to check and potentially refresh
 * @param userId The user ID who owns the credential (for security verification)
 * @param requestId Request ID for log correlation
 * @param scopes Optional scopes for service account token generation
 * @returns The valid access token or null if refresh fails
 */
export async function refreshAccessTokenIfNeeded(
  credentialId: string,
  userId: string,
  requestId: string,
  scopes?: string[],
  impersonateEmail?: string
): Promise<string | null> {
  const result = await resolveCredentialAccessToken(
    credentialId,
    userId,
    requestId,
    scopes,
    impersonateEmail
  )
  return result?.accessToken ?? null
}

/**
 * Enhanced version that returns additional information about the refresh operation
 */
export async function refreshTokenIfNeeded(
  requestId: string,
  credential: any,
  credentialId: string
): Promise<{ accessToken: string; refreshed: boolean }> {
  const resolvedCredentialId = credential.resolvedCredentialId ?? credentialId

  // Decide if we should refresh: token missing OR expired
  const accessTokenExpiresAt = credential.accessTokenExpiresAt
  const refreshTokenExpiresAt = credential.refreshTokenExpiresAt
  const now = new Date()

  // Check if access token needs refresh (missing or expired)
  const accessTokenNeedsRefresh =
    !!credential.refreshToken &&
    (!credential.accessToken || (accessTokenExpiresAt && accessTokenExpiresAt <= now))

  // Check if we should proactively refresh to prevent refresh token expiry
  // This applies to Microsoft providers whose refresh tokens expire after 90 days of inactivity
  const proactiveRefreshThreshold = new Date(
    now.getTime() + PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  const refreshTokenNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isMicrosoftProvider(credential.providerId) &&
    refreshTokenExpiresAt &&
    refreshTokenExpiresAt <= proactiveRefreshThreshold

  // Instagram long-lived tokens can only be refreshed while still valid.
  const instagramNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isInstagramProvider(credential.providerId) &&
    shouldProactivelyRefreshInstagramToken({
      accessTokenExpiresAt,
      updatedAt: credential.updatedAt,
      now,
    })

  const shouldRefresh =
    accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh || instagramNeedsProactiveRefresh

  // If token appears valid and present, return it directly
  if (!shouldRefresh) {
    logger.info(`[${requestId}] Access token is valid`)
    return { accessToken: credential.accessToken, refreshed: false }
  }

  const outcome = await performCoalescedRefresh({
    accountId: resolvedCredentialId,
    providerId: credential.providerId,
    refreshToken: credential.refreshToken!,
    providerAccountId: credential.accountId,
    requestId,
    userId: credential.userId,
  })
  if (outcome.accessToken) return { accessToken: outcome.accessToken, refreshed: true }

  if (!accessTokenNeedsRefresh && credential.accessToken) {
    logger.info(`[${requestId}] Refresh unavailable; reusing still-valid access token`)
    return { accessToken: credential.accessToken, refreshed: false }
  }
  throw outcome.error ?? new Error('Failed to refresh token')
}
