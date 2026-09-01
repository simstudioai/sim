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
import { decryptAccountTokenColumnsBatch } from '@/lib/oauth/account-tokens'
import { providerIdsForService } from '@/lib/oauth/utils'

const logger = createLogger('CredentialOAuthAccounts')

interface GoogleIdToken {
  email?: string
  name?: string
}

export async function listOAuthConnectionsForUser(userId: string): Promise<OAuthConnection[]> {
  const [accountRows, userRecord] = await Promise.all([
    db
      .select({
        id: account.id,
        accountId: account.accountId,
        providerId: account.providerId,
        scope: account.scope,
        // account-token-access-allow: decrypted immediately below; needed for the display-name JWT decode
        idToken: account.idToken,
        updatedAt: account.updatedAt,
      })
      .from(account)
      .where(eq(account.userId, userId)),
    db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1),
  ])
  const accounts = await decryptAccountTokenColumnsBatch(accountRows)
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
        logger.warn('Failed to decode OAuth account ID token', { accountId: accountRow.id, error })
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
  const targetAccounts = await db.select({ id: account.id }).from(account).where(accountFilter)
  const targetAccountIds = targetAccounts.map((row) => row.id)
  if (targetAccountIds.length === 0) return { credentials: [] }

  const credentialRows = await db
    .select()
    .from(credential)
    .where(inArray(credential.accountId, targetAccountIds))
  const deletedCredentials: typeof credentialRows = []
  try {
    for (const credentialRow of credentialRows) {
      if (credentialRow.type !== 'oauth') {
        throw new Error(`OAuth account ${credentialRow.accountId} owns a non-OAuth credential`)
      }
      const deleted = await deleteCredentialRecord({
        credential: credentialRow,
        reason: 'oauth_disconnect',
      })
      if (deleted) deletedCredentials.push(credentialRow)
    }
    await db.delete(account).where(inArray(account.id, targetAccountIds))
  } catch (error) {
    if (deletedCredentials.length === 0) throw error
    throw new OAuthDisconnectPartialFailureError(deletedCredentials, error)
  }
  return { credentials: deletedCredentials }
}
