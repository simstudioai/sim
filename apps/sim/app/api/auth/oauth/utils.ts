import { createSign } from 'crypto'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import { and, desc, eq } from 'drizzle-orm'
import { withLeaderLock } from '@/lib/concurrency/leader-lock'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { decryptSecret } from '@/lib/core/security/encryption'
import { isTokenServiceAccountProviderId } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  parseTokenServiceAccountSecretBlob,
  type TokenServiceAccountSecretBlob,
} from '@/lib/credentials/token-service-accounts/server'
import { refreshOAuthToken } from '@/lib/oauth'
import {
  getMicrosoftRefreshTokenExpiry,
  isMicrosoftProvider,
  PROACTIVE_REFRESH_THRESHOLD_DAYS,
} from '@/lib/oauth/microsoft'
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
 * For Atlassian service accounts, the API token IS the access token —
 * blocks call api.atlassian.com/ex/jira/{cloudId}/... with `Authorization: Bearer {apiToken}`.
 * No exchange or refresh is needed; we just decrypt and return the raw token.
 */
export interface ServiceAccountTokenResult {
  accessToken: string
  /** Atlassian only — the resolved Jira/Confluence cloud id. */
  cloudId?: string
  /** Atlassian only — the site domain. */
  domain?: string
}

/**
 * Single dispatch point for turning a `service_account` credential into an
 * access token, keyed on `providerId`. Both `refreshAccessTokenIfNeeded` and the
 * `POST /api/auth/oauth/token` route go through here, so a new service-account
 * provider is one edit and an unknown provider fails loudly instead of silently
 * attempting a Google JWT.
 */
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

export async function resolveServiceAccountToken(
  credentialId: string,
  providerId: string | null | undefined,
  scopes?: string[],
  impersonateEmail?: string
): Promise<ServiceAccountTokenResult> {
  if (providerId && isTokenServiceAccountProviderId(providerId)) {
    const secret = await getTokenServiceAccountSecret(credentialId, providerId)
    return { accessToken: secret.apiToken, domain: secret.domain }
  }
  if (providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
    const secret = await getAtlassianServiceAccountSecret(credentialId)
    return { accessToken: secret.apiToken, cloudId: secret.cloudId, domain: secret.domain }
  }
  if (providerId === SLACK_CUSTOM_BOT_PROVIDER_ID) {
    const botCredential = await getSlackBotCredential(credentialId)
    if (!botCredential) {
      throw new Error('Slack bot credential not found')
    }
    return { accessToken: botCredential.botToken }
  }
  if (providerId === GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID) {
    if (!scopes?.length) {
      throw new Error('Scopes are required for service account credentials')
    }
    return { accessToken: await getServiceAccountToken(credentialId, scopes, impersonateEmail) }
  }
  throw new Error(`Unsupported service-account provider: ${providerId ?? 'unknown'}`)
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
  requestId?: string
  userId?: string
}

async function performCoalescedRefresh({
  accountId,
  providerId,
  refreshToken,
  requestId,
  userId,
}: CoalescedRefreshOptions): Promise<string | null> {
  const logContext = {
    ...(requestId ? { requestId } : {}),
    ...(userId ? { userId } : {}),
    providerId,
    accountId,
  }

  const deadCode = await getRecentTerminalError(accountId)
  if (deadCode) {
    logger.warn('Skipping refresh: credential recently failed', {
      ...logContext,
      errorCode: deadCode,
    })
    return null
  }

  const lockKey = `oauth:refresh:${accountId}`

  const refreshPromise = coalesceLocally(lockKey, () =>
    withLeaderLock<string>({
      key: lockKey,
      onLeader: async () => {
        try {
          const result = await refreshOAuthToken(providerId, refreshToken)

          if (!result.ok) {
            logger.error('Failed to refresh token', {
              ...logContext,
              errorCode: result.errorCode,
            })
            if (result.errorCode && isTerminalRefreshError(result.errorCode)) {
              await markCredentialDead(accountId, result.errorCode)
            }
            return null
          }

          const updateData: Record<string, unknown> = {
            accessToken: result.accessToken,
            accessTokenExpiresAt: new Date(Date.now() + result.expiresIn * 1000),
            updatedAt: new Date(),
          }
          if (result.refreshToken && result.refreshToken !== refreshToken) {
            updateData.refreshToken = result.refreshToken
          }
          if (isMicrosoftProvider(providerId)) {
            updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
          }

          await db.update(account).set(updateData).where(eq(account.id, accountId))

          logger.info('Successfully refreshed access token', logContext)
          return result.accessToken
        } catch (error) {
          logger.error('Refresh failed inside leader path', {
            ...logContext,
            error: toError(error).message,
          })
          return null
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
            return row.accessToken
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
    return await refreshPromise
  } catch (error) {
    logger.error('Coalesced refresh did not settle', {
      ...logContext,
      error: toError(error).message,
    })
    return null
  }
}

export async function getOAuthToken(userId: string, providerId: string): Promise<string | null> {
  const connections = await db
    .select({
      id: account.id,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      idToken: account.idToken,
      scope: account.scope,
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

  // Determine whether we should refresh: missing token OR expired token
  const now = new Date()
  const tokenExpiry = credential.accessTokenExpiresAt
  const shouldAttemptRefresh =
    !!credential.refreshToken && (!credential.accessToken || (tokenExpiry && tokenExpiry < now))

  if (shouldAttemptRefresh) {
    return performCoalescedRefresh({
      accountId: credential.id,
      providerId,
      refreshToken: credential.refreshToken!,
      userId,
    })
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
 * Refreshes an OAuth token if needed based on credential information.
 * Also handles service account credentials by generating a JWT-based token.
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
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    return null
  }

  if (resolved.credentialType === 'service_account' && resolved.credentialId) {
    logger.info(`[${requestId}] Using service account token for credential`)
    const { accessToken } = await resolveServiceAccountToken(
      resolved.credentialId,
      resolved.providerId,
      scopes,
      impersonateEmail
    )
    return accessToken
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

  const shouldRefresh = accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh

  const accessToken = credential.accessToken

  if (shouldRefresh) {
    const resolvedCredentialId =
      (credential as { resolvedCredentialId?: string }).resolvedCredentialId ?? credentialId

    const fresh = await performCoalescedRefresh({
      accountId: resolvedCredentialId,
      providerId: credential.providerId,
      refreshToken: credential.refreshToken!,
      requestId,
      userId: credential.userId,
    })
    if (fresh) return fresh

    // If refresh was only triggered proactively (Microsoft refresh-token aging),
    // the still-valid access token is a fine fallback.
    if (!accessTokenNeedsRefresh && accessToken) {
      logger.info(`[${requestId}] Refresh unavailable; reusing still-valid access token`)
      return accessToken
    }
    return null
  }
  if (!accessToken) {
    // We have no access token and either no refresh token or not eligible to refresh
    logger.error(`[${requestId}] Missing access token for credential`)
    return null
  }

  logger.info(`[${requestId}] Access token is valid for credential`)
  return accessToken
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

  const shouldRefresh = accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh

  // If token appears valid and present, return it directly
  if (!shouldRefresh) {
    logger.info(`[${requestId}] Access token is valid`)
    return { accessToken: credential.accessToken, refreshed: false }
  }

  const fresh = await performCoalescedRefresh({
    accountId: resolvedCredentialId,
    providerId: credential.providerId,
    refreshToken: credential.refreshToken!,
    requestId,
    userId: credential.userId,
  })
  if (fresh) return { accessToken: fresh, refreshed: true }

  if (!accessTokenNeedsRefresh && credential.accessToken) {
    logger.info(`[${requestId}] Refresh unavailable; reusing still-valid access token`)
    return { accessToken: credential.accessToken, refreshed: false }
  }
  throw new Error('Failed to refresh token')
}
