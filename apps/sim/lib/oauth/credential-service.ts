import { createSign } from 'crypto'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
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
import {
  type DecryptedAccount,
  decryptAccountTokenColumns,
  encryptAccountTokenColumns,
} from '@/lib/oauth/account-tokens'
import { getMicrosoftRefreshTokenExpiry, isMicrosoftProvider } from '@/lib/oauth/microsoft'
import { refreshOAuthToken } from '@/lib/oauth/oauth'
import { decideTokenRefresh } from '@/lib/oauth/refresh-policy'
import {
  extractSlackTeamId,
  fanOutSlackTokenChain,
  getFreshestSlackChain,
  hasSlackChainMoved,
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

const logger = createLogger('OAuthCredentialService')

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

    if (credentialRow.type === 'managed_oauth') {
      return {
        accountId: '',
        credentialId: credentialRow.id,
        credentialType: 'managed_oauth',
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
  /** Required only when the bot receives Slack events; action-only bots may omit it. */
  signingSecret?: string
  botToken: string
  /** Present on newly connected bots; legacy backfills resolve it only when needed. */
  teamId?: string
  botUserId?: string
  teamName?: string
  /** Owning workspace — callers with a user/workflow context must verify it. */
  workspaceId: string | null
}

/**
 * Decrypt a reusable custom Slack bot credential — a `service_account` credential
 * with `providerId='slack-custom-bot'` whose encrypted blob holds the bring-your-own
 * app's bot token and, when configured for event ingestion, its signing secret.
 * Newly connected bots also hold derived team identity; legacy backfills may not.
 * Returns null if the id is not such a credential or the action-capable portion
 * of its blob is incomplete.
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
  if (!blob.botToken) {
    return null
  }
  return {
    ...(typeof blob.signingSecret === 'string' && blob.signingSecret
      ? { signingSecret: blob.signingSecret }
      : {}),
    botToken: blob.botToken,
    ...(typeof blob.teamId === 'string' && blob.teamId ? { teamId: blob.teamId } : {}),
    ...(typeof blob.botUserId === 'string' && blob.botUserId ? { botUserId: blob.botUserId } : {}),
    ...(typeof blob.teamName === 'string' && blob.teamName ? { teamName: blob.teamName } : {}),
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
  /** Salesforce or NetSuite — the provider origin the token must be used against. */
  instanceUrl?: string
  /**
   * Zoho Desk only — the data-center-scoped Desk REST base the token must be
   * used against, forwarded to tools as their `apiDomain` param.
   */
  apiDomain?: string
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
  /** Salesforce or NetSuite — the provider origin returned alongside the minted token. */
  instanceUrl?: string
  /** Zoho Desk only — the Desk REST base derived from the token's api_domain. */
  apiDomain?: string
}

interface FailedClientCredentialMint {
  /** The error the failed mint threw, re-thrown to callers while memoized. */
  error: unknown
  secretFingerprint: string
  expiresAtMs: number
}

/**
 * Per-instance cache of minted client-credential access tokens (Zoom S2S,
 * Box CCG, Salesforce, NetSuite), keyed by credential id. Entries are
 * served while more than {@link CLIENT_CREDENTIAL_TOKEN_MIN_TTL_MS} of
 * validity remains, so a hot credential mints roughly once per token TTL
 * (~1h for Zoom/Box/NetSuite; Salesforce reports a conservative 10-minute TTL
 * because its responses never carry an expiry) per instance.
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
 * access token: decrypts the stored credential material (client id + secret,
 * or the private key and run-as username for key-based grants) and mints via
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
      return {
        accessToken: cached.accessToken,
        instanceUrl: cached.instanceUrl,
        apiDomain: cached.apiDomain,
      }
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
          certificateId: blob.certificateId,
          orgId: blob.orgId,
          dataCenter: blob.dataCenter,
          authMethod: blob.authMethod,
          privateKey: blob.privateKey,
          username: blob.username,
        },
        { skipIdentity: true }
      )
      clientCredentialTokenCache.set(credentialId, {
        accessToken: mint.accessToken,
        expiresAtMs: Date.now() + mint.expiresInSeconds * 1000,
        secretFingerprint,
        instanceUrl: mint.instanceUrl,
        apiDomain: mint.apiDomain,
      })
      return {
        accessToken: mint.accessToken,
        instanceUrl: mint.instanceUrl,
        apiDomain: mint.apiDomain,
      }
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
 * Everything a credential consumer needs, and nothing else — notably not `password`, which
 * a bare `select()` would carry into every object built from one of these rows.
 */
const OAUTH_CREDENTIAL_COLUMNS = {
  id: account.id,
  userId: account.userId,
  providerId: account.providerId,
  accountId: account.accountId,
  scope: account.scope,
  accessToken: account.accessToken,
  refreshToken: account.refreshToken,
  idToken: account.idToken,
  accessTokenExpiresAt: account.accessTokenExpiresAt,
  refreshTokenExpiresAt: account.refreshTokenExpiresAt,
  updatedAt: account.updatedAt,
} as const

/**
 * Finds the account row a provider's external identity maps to, projecting only its id.
 *
 * The connect flows that bypass Better Auth (Shopify, Instagram, Trello) each need this
 * before deciding between update and insert, and again to resolve the persisted row. They
 * must not select the whole row: that pulls the encrypted token columns for no reason.
 */
export async function findAccountIdByProviderAccount(params: {
  userId: string
  providerId: string
  externalAccountId: string
}): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, params.userId),
        eq(account.providerId, params.providerId),
        eq(account.accountId, params.externalAccountId)
      )
    )
    .limit(1)
  return row
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
    await db.insert(account).values(await encryptAccountTokenColumns(data))
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
 * The single write path for the connect flows that bypass Better Auth — Shopify, Instagram
 * and Trello, which mint tokens themselves rather than going through an OAuth callback the
 * `databaseHooks` can intercept.
 *
 * Routing them through here is what keeps encryption from being something each new provider
 * has to remember: `scripts/check-account-token-access.ts` refuses a direct
 * `db.insert(account)` / `db.update(account)` outside this module, so the next connect flow
 * cannot quietly store a plaintext token.
 */
export async function upsertProviderAccountTokens(params: {
  userId: string
  providerId: string
  externalAccountId: string
  scope: string
  tokens: { accessToken: string; refreshToken?: string; idToken?: string }
  accessTokenExpiresAt?: Date
  /** Human-readable identifier for log lines, when the external id is not recognisable. */
  logIdentifier?: string
}): Promise<{ accountId: string }> {
  const { userId, providerId, externalAccountId, scope, tokens, accessTokenExpiresAt } = params
  const identifier = params.logIdentifier ?? externalAccountId
  const now = new Date()
  const existing = await findAccountIdByProviderAccount({ userId, providerId, externalAccountId })

  if (existing) {
    await db
      .update(account)
      .set({
        ...(await encryptAccountTokenColumns(tokens)),
        accountId: externalAccountId,
        scope,
        ...(accessTokenExpiresAt ? { accessTokenExpiresAt } : {}),
        updatedAt: now,
      })
      .where(eq(account.id, existing.id))
    logger.info(`Updated existing ${providerId} account`, { accountId: existing.id, identifier })
    return { accountId: existing.id }
  }

  await safeAccountInsert(
    {
      id: generateId(),
      userId,
      providerId,
      accountId: externalAccountId,
      scope,
      ...tokens,
      ...(accessTokenExpiresAt ? { accessTokenExpiresAt } : {}),
      createdAt: now,
      updatedAt: now,
    },
    { provider: providerId, identifier }
  )

  /** `safeAccountInsert` swallows a duplicate-key race, so the row may be someone else's insert. */
  const persisted = await findAccountIdByProviderAccount({ userId, providerId, externalAccountId })
  if (!persisted) {
    throw new Error(`${providerId} OAuth account ${externalAccountId} was not persisted`)
  }
  return { accountId: persisted.id }
}

/**
 * Get a credential by resolved account ID and verify it belongs to the user.
 */
async function getCredentialByAccountId(requestId: string, accountId: string, userId: string) {
  const rows = await db
    .select(OAUTH_CREDENTIAL_COLUMNS)
    .from(account)
    .where(and(eq(account.id, accountId), eq(account.userId, userId)))
    .limit(1)

  if (!rows.length) {
    logger.warn(`[${requestId}] Credential not found`)
    return undefined
  }

  const credential = await decryptAccountTokenColumns(rows[0])

  return {
    ...credential,
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

/**
 * Slack lock budgets sized past `TOKEN_REFRESH_TIMEOUT_MS` (15s) in
 * lib/oauth/oauth.ts: installation-keyed locks make every sibling row's request
 * a follower of one refresh, so the TTL covers the provider call plus generous
 * headroom for the surrounding DB reads and the fan-out write, and followers
 * poll for the lock's full lifetime so a slow-but-successful refresh is still
 * observed rather than reported as a failure. These budgets are latency knobs,
 * not correctness guarantees — chain integrity under lock expiry or unlocked
 * concurrent writers is enforced by the version-guarded fan-out
 * (`ifChainUnchangedSince` in lib/oauth/slack.ts).
 */
const SLACK_LOCK_TTL_SEC = 30
const SLACK_FOLLOWER_MAX_WAIT_MS = SLACK_LOCK_TTL_SEC * 1000

async function performCoalescedRefresh({
  accountId,
  providerId,
  refreshToken,
  providerAccountId,
  requestId,
  userId,
}: CoalescedRefreshOptions): Promise<string | null> {
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
    return null
  }

  const lockKey = `oauth:refresh:${scopeKey}`

  const refreshPromise = coalesceLocally(lockKey, () =>
    withLeaderLock<string>({
      key: lockKey,
      // Installation-keyed Slack locks gather followers from every sibling row,
      // so their wait and the lock TTL must outlast the 15s provider timeout —
      // the 3s/10s defaults would fail followers early and let a second leader
      // start a concurrent rotation mid-refresh.
      ...(slackTeamId ? { maxWaitMs: SLACK_FOLLOWER_MAX_WAIT_MS, ttlSec: SLACK_LOCK_TTL_SEC } : {}),
      onLeader: async () => {
        try {
          let refreshTokenToUse = refreshToken
          let slackChainVersion: Date | null = null
          if (slackTeamId) {
            const freshest = await getFreshestSlackChain(slackTeamId)
            if (!freshest) {
              throw new Error(
                `No refresh-capable account row found for Slack installation ${slackTeamId}`
              )
            }
            slackChainVersion = freshest.chainVersion
            if (
              freshest.accessToken &&
              freshest.accessTokenExpiresAt &&
              freshest.accessTokenExpiresAt > new Date()
            ) {
              await fanOutSlackTokenChain(
                slackTeamId,
                {
                  accessToken: freshest.accessToken,
                  refreshToken: freshest.refreshToken,
                  accessTokenExpiresAt: freshest.accessTokenExpiresAt,
                },
                { ifChainUnchangedSince: freshest.chainVersion }
              )
              logger.info('Reused freshest Slack installation token', logContext)
              return freshest.accessToken
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
              // A refresh that lost a race with a concurrent connect fails with
              // a revoked/rotated-out token even though the installation just
              // got a live chain — dead-flagging then would take down a healthy
              // credential for an hour.
              if (
                slackChainVersion &&
                (await hasSlackChainMoved(slackTeamId!, slackChainVersion))
              ) {
                logger.info('Skipping dead flag: Slack chain moved during refresh', logContext)
              } else {
                await markCredentialDead(scopeKey, result.errorCode)
              }
            }
            return null
          }

          const accessTokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000)

          if (slackTeamId) {
            await fanOutSlackTokenChain(
              slackTeamId,
              {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken || refreshTokenToUse,
                accessTokenExpiresAt,
              },
              { ifChainUnchangedSince: slackChainVersion ?? undefined }
            )
          } else {
            /**
             * Compare plaintext to plaintext. If either side became ciphertext they would
             * never match, so every refresh would write and perturb `updated_at` — which
             * Slack's fan-out guard and Instagram's minimum-token-age gate both read.
             */
            const rotatedRefreshToken =
              result.refreshToken && result.refreshToken !== refreshToken
                ? result.refreshToken
                : undefined

            const updateData: Record<string, unknown> = {
              ...(await encryptAccountTokenColumns({
                accessToken: result.accessToken,
                ...(rotatedRefreshToken ? { refreshToken: rotatedRefreshToken } : {}),
              })),
              accessTokenExpiresAt,
              updatedAt: new Date(),
            }
            if (isMicrosoftProvider(providerId)) {
              updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
            }

            await db.update(account).set(updateData).where(eq(account.id, accountId))
          }

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
          const [stored] = await db
            .select({
              accessToken: account.accessToken,
              accessTokenExpiresAt: account.accessTokenExpiresAt,
            })
            .from(account)
            .where(eq(account.id, accountId))
            .limit(1)
          if (!stored) return null

          /** The leader may have written ciphertext while this follower polled. */
          const row = await decryptAccountTokenColumns(stored)
          if (
            row.accessToken &&
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
      providerAccountId: account.accountId,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt,
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

  const credential = await decryptAccountTokenColumns(connections[0])

  const decision = decideTokenRefresh({
    providerId,
    hasAccessToken: !!credential.accessToken,
    hasRefreshToken: !!credential.refreshToken,
    accessTokenExpiresAt: credential.accessTokenExpiresAt,
    refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
    updatedAt: credential.updatedAt,
  })

  if (decision.shouldRefresh) {
    const fresh = await performCoalescedRefresh({
      accountId: credential.id,
      providerId,
      refreshToken: credential.refreshToken!,
      providerAccountId: credential.providerAccountId,
      userId,
    })
    if (fresh) return fresh
    if (!decision.accessTokenRequired && credential.accessToken) {
      return credential.accessToken
    }
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

  try {
    const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
    return { accessToken }
  } catch (error) {
    logger.error(`[${requestId}] Could not resolve an access token for credential`, {
      error: toError(error).message,
    })
    return null
  }
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

/** A loaded `account` row whose tokens are already decrypted. The brand rejects a raw row. */
export type LoadedOAuthCredential = DecryptedAccount<{
  providerId: string
  accountId: string
  userId: string
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  accessTokenExpiresAt: Date | null
  refreshTokenExpiresAt: Date | null
  updatedAt: Date
  resolvedCredentialId?: string
}>

/** Loads an account row, decrypts it, and resolves its access token per the shared policy. */
export async function resolveAccessTokenForAccount(
  requestId: string,
  accountId: string
): Promise<string | null> {
  const [row] = await db
    .select(OAUTH_CREDENTIAL_COLUMNS)
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1)
  if (!row) {
    logger.warn(`[${requestId}] Account not found`, { accountId })
    return null
  }

  const credential = await decryptAccountTokenColumns(row)
  try {
    const { accessToken } = await refreshTokenIfNeeded(requestId, credential, accountId)
    return accessToken
  } catch (error) {
    logger.error(`[${requestId}] Failed to resolve access token`, {
      accountId,
      error: toError(error).message,
    })
    return null
  }
}

/**
 * Refreshes if the shared policy says so, reporting whether it did. See
 * {@link resolveAccessTokenForAccount} when you only have an account id.
 */
export async function refreshTokenIfNeeded(
  requestId: string,
  credential: LoadedOAuthCredential,
  credentialId: string
): Promise<{ accessToken: string; refreshed: boolean }> {
  const resolvedCredentialId = credential.resolvedCredentialId ?? credentialId

  const decision = decideTokenRefresh({
    providerId: credential.providerId,
    hasAccessToken: !!credential.accessToken,
    hasRefreshToken: !!credential.refreshToken,
    accessTokenExpiresAt: credential.accessTokenExpiresAt,
    refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
    updatedAt: credential.updatedAt,
  })

  if (!decision.shouldRefresh) {
    /** Previously returned `{ accessToken: null }` — the parameter was `any` — and callers passed it to a provider. */
    if (!credential.accessToken) {
      throw new Error('Credential has no access token and cannot be refreshed')
    }
    logger.info(`[${requestId}] Access token is valid`)
    return { accessToken: credential.accessToken, refreshed: false }
  }

  const fresh = await performCoalescedRefresh({
    accountId: resolvedCredentialId,
    providerId: credential.providerId,
    refreshToken: credential.refreshToken!,
    providerAccountId: credential.accountId,
    requestId,
    userId: credential.userId,
  })
  if (fresh) return { accessToken: fresh, refreshed: true }

  if (!decision.accessTokenRequired && credential.accessToken) {
    logger.info(`[${requestId}] Refresh unavailable; reusing still-valid access token`)
    return { accessToken: credential.accessToken, refreshed: false }
  }
  throw new Error('Failed to refresh token')
}
