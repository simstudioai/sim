import { db } from '@sim/db'
import { account, credential, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, desc, eq, inArray, like, or } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import type { OAuthConnection } from '@/lib/api/contracts/oauth-connections'
import { deleteCredentialRecord } from '@/lib/credentials/orchestration'
import type { OAuthProvider } from '@/lib/oauth'
import { parseProvider } from '@/lib/oauth'
import { QuickBooksTokenRevocationError, revokeQuickBooksToken } from '@/lib/oauth/quickbooks'
import {
  decryptQuickBooksOAuthClientConfig,
  QuickBooksOAuthClientConfigurationError,
} from '@/lib/oauth/quickbooks-client-config'
import { providerIdsForService } from '@/lib/oauth/utils'

const logger = createLogger('CredentialOAuthAccounts')
const MAX_DISCONNECT_ACCOUNTS = 100
const MAX_DISCONNECT_CREDENTIALS = 1000
const QUICKBOOKS_DISCONNECT_TIMEOUT_MS = 30_000

interface GoogleIdToken {
  email?: string
  name?: string
}

export async function listOAuthConnectionsForUser(userId: string): Promise<OAuthConnection[]> {
  const [accounts, userRecord] = await Promise.all([
    db.select().from(account).where(eq(account.userId, userId)),
    db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1),
  ])
  const userEmail = userRecord[0]?.email ?? null
  const connections: OAuthConnection[] = []

  for (const accountRow of accounts) {
    const { baseProvider, featureType } = parseProvider(accountRow.providerId as OAuthProvider)
    if (!baseProvider) continue
    const scopes = accountRow.scope?.split(/\s+/).filter(Boolean) ?? []
    let displayName = ''
    if (accountRow.idToken) {
      try {
        const decoded = decodeJwt<GoogleIdToken>(accountRow.idToken)
        displayName = decoded.email || decoded.name || ''
      } catch (error) {
        logger.warn('Failed to decode OAuth account ID token', {
          accountId: accountRow.id,
          error,
        })
      }
    }
    if (!displayName && baseProvider === 'github') {
      displayName = `${accountRow.accountId} (GitHub)`
    }
    displayName ||= userEmail || `${accountRow.accountId} (${baseProvider})`

    const existing = connections.find((connection) => connection.provider === accountRow.providerId)
    if (existing) {
      existing.accounts.push({ id: accountRow.id, name: displayName })
      existing.scopes = Array.from(new Set([...existing.scopes, ...scopes]))
      if (accountRow.updatedAt.getTime() > new Date(existing.lastConnected).getTime()) {
        existing.lastConnected = accountRow.updatedAt.toISOString()
      }
      continue
    }
    connections.push({
      provider: accountRow.providerId,
      baseProvider,
      featureType,
      isConnected: true,
      scopes,
      lastConnected: accountRow.updatedAt.toISOString(),
      accounts: [{ id: accountRow.id, name: displayName }],
    })
  }

  return connections
}

export async function listConnectedAccountsForUser(params: { userId: string; provider?: string }) {
  const whereConditions = [eq(account.userId, params.userId)]
  if (params.provider) whereConditions.push(eq(account.providerId, params.provider))
  const rows = await db
    .select({
      id: account.id,
      accountId: account.accountId,
      providerId: account.providerId,
      credentialDisplayName: credential.displayName,
    })
    .from(account)
    .leftJoin(credential, eq(credential.accountId, account.id))
    .where(and(...whereConditions))
    .orderBy(desc(account.updatedAt))

  const seen = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!seen.has(row.id)) seen.set(row.id, row)
  }
  return Array.from(seen.values()).map((row) => ({
    id: row.id,
    accountId: row.accountId,
    providerId: row.providerId,
    displayName: row.credentialDisplayName || row.accountId || row.providerId,
  }))
}

export interface DisconnectOAuthAccountsParams {
  userId: string
  provider: string
  providerId?: string
  accountId?: string
}

export class OAuthDisconnectPartialFailureError extends Error {
  constructor(
    readonly credentials: Array<typeof credential.$inferSelect>,
    cause: unknown
  ) {
    const error = toError(cause)
    super(error.message, { cause: error })
    this.name = 'OAuthDisconnectPartialFailureError'
  }
}

export class OAuthProviderRevocationError extends Error {
  constructor(
    readonly providerId: string,
    cause: unknown
  ) {
    super(`Unable to revoke ${providerId} access. Please try again.`, {
      cause: toError(cause),
    })
    this.name = 'OAuthProviderRevocationError'
  }
}

export class OAuthDisconnectConfigurationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause: toError(cause) })
    this.name = 'OAuthDisconnectConfigurationError'
  }
}

export class OAuthDisconnectLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthDisconnectLimitError'
  }
}

export async function disconnectOAuthAccounts(params: DisconnectOAuthAccountsParams) {
  const accountFilter = params.accountId
    ? and(eq(account.userId, params.userId), eq(account.id, params.accountId))
    : params.providerId
      ? and(eq(account.userId, params.userId), eq(account.providerId, params.providerId))
      : and(
          eq(account.userId, params.userId),
          or(
            inArray(account.providerId, providerIdsForService(params.provider)),
            like(account.providerId, `${params.provider}-%`)
          )
        )
  const targetAccounts = await db
    .select({
      id: account.id,
      providerId: account.providerId,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      oauthConfig: account.oauthConfig,
      updatedAt: account.updatedAt,
    })
    .from(account)
    .where(accountFilter)
    .limit(MAX_DISCONNECT_ACCOUNTS + 1)
  if (targetAccounts.length > MAX_DISCONNECT_ACCOUNTS) {
    throw new OAuthDisconnectLimitError('Too many linked accounts to disconnect in one request')
  }
  const targetAccountIds = targetAccounts.map((row) => row.id)
  if (targetAccountIds.length === 0) return { credentials: [] }

  const credentialRows = await db
    .select()
    .from(credential)
    .where(inArray(credential.accountId, targetAccountIds))
    .limit(MAX_DISCONNECT_CREDENTIALS + 1)
  if (credentialRows.length > MAX_DISCONNECT_CREDENTIALS) {
    throw new OAuthDisconnectLimitError('Too many linked credentials to disconnect in one request')
  }
  for (const credentialRow of credentialRows) {
    if (credentialRow.type !== 'oauth') {
      throw new Error(`OAuth account ${credentialRow.accountId} owns a non-OAuth credential`)
    }
  }

  const credentialsByAccount = new Map<string, typeof credentialRows>()
  for (const credentialRow of credentialRows) {
    if (!credentialRow.accountId) continue
    const rows = credentialsByAccount.get(credentialRow.accountId) ?? []
    rows.push(credentialRow)
    credentialsByAccount.set(credentialRow.accountId, rows)
  }

  const quickBooksDisconnectSignal = AbortSignal.timeout(QUICKBOOKS_DISCONNECT_TIMEOUT_MS)
  const deletedCredentials: typeof credentialRows = []
  try {
    for (const targetAccount of targetAccounts) {
      let expectedAccountVersion: Date | undefined
      if (targetAccount.providerId === 'quickbooks') {
        const token = targetAccount.refreshToken?.trim() || targetAccount.accessToken?.trim()
        if (token) {
          if (!targetAccount.oauthConfig) {
            throw new OAuthDisconnectConfigurationError(
              'QuickBooks OAuth client configuration is missing. Reconnect the account and try again.'
            )
          }
          let clientConfig
          try {
            clientConfig = await decryptQuickBooksOAuthClientConfig(targetAccount.oauthConfig)
          } catch (error) {
            if (!(error instanceof QuickBooksOAuthClientConfigurationError)) throw error
            throw new OAuthDisconnectConfigurationError(
              'QuickBooks OAuth client configuration is invalid. Reconnect the account and try again.',
              error
            )
          }
          try {
            await revokeQuickBooksToken(token, clientConfig, quickBooksDisconnectSignal)
          } catch (error) {
            if (error instanceof QuickBooksTokenRevocationError && !error.retryable) {
              throw new OAuthDisconnectConfigurationError(
                'Intuit rejected the QuickBooks revocation request. Reconnect the account and try again.',
                error
              )
            }
            throw new OAuthProviderRevocationError('QuickBooks', error)
          }
        }

        const cleanupVersion = new Date()
        const claimedAccounts = await db
          .update(account)
          .set({
            accessToken: null,
            refreshToken: null,
            idToken: null,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
            updatedAt: cleanupVersion,
          })
          .where(
            and(
              eq(account.id, targetAccount.id),
              eq(account.userId, params.userId),
              eq(account.updatedAt, targetAccount.updatedAt)
            )
          )
          .returning({ id: account.id })
        if (claimedAccounts.length === 0) continue
        expectedAccountVersion = cleanupVersion
      }

      for (const credentialRow of credentialsByAccount.get(targetAccount.id) ?? []) {
        const deleted = await deleteCredentialRecord({
          credential: credentialRow,
          reason: 'oauth_disconnect',
        })
        if (deleted) deletedCredentials.push(credentialRow)
      }
      await db
        .delete(account)
        .where(
          and(
            eq(account.id, targetAccount.id),
            eq(account.userId, params.userId),
            expectedAccountVersion ? eq(account.updatedAt, expectedAccountVersion) : undefined
          )
        )
    }
  } catch (error) {
    if (deletedCredentials.length === 0) throw error
    throw new OAuthDisconnectPartialFailureError(deletedCredentials, error)
  }
  return { credentials: deletedCredentials }
}
