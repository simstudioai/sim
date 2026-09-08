import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { and, eq, like } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/api/list-query'
import {
  normalizeQuickBooksRealmId,
  parseQuickBooksAccountId,
  type QuickBooksAccountIdentity,
} from '@/lib/oauth/quickbooks'
import {
  decryptQuickBooksOAuthClientConfig,
  deriveQuickBooksWebhookAppKey,
  QUICKBOOKS_WEBHOOK_APP_KEY_PATTERN,
  type QuickBooksOAuthClientConfig,
  QuickBooksOAuthClientConfigurationError,
} from '@/lib/oauth/quickbooks-client-config'

const QUICKBOOKS_ACCOUNT_PREFIX = 'quickbooks:v2:'
const MAX_QUICKBOOKS_WEBHOOK_APP_ACCOUNTS = 1000

export interface QuickBooksWebhookCredentialContext {
  clientConfig: QuickBooksOAuthClientConfig
  identity: QuickBooksAccountIdentity
}

function normalizeQuickBooksWebhookAppKey(appKey: string): string {
  const normalized = appKey.trim()
  if (!QUICKBOOKS_WEBHOOK_APP_KEY_PATTERN.test(normalized)) {
    throw new Error('QuickBooks webhook app key is invalid')
  }
  return normalized
}

export function buildQuickBooksWebhookAccountIdPattern(appKey: string): string {
  const normalizedAppKey = normalizeQuickBooksWebhookAppKey(appKey)
  return `${escapeLikePattern(QUICKBOOKS_ACCOUNT_PREFIX)}${escapeLikePattern(normalizedAppKey)}:%`
}

async function decryptValidatedClientConfig(
  accountId: string,
  oauthConfig: string | null,
  expectedAppKey: string
): Promise<QuickBooksOAuthClientConfig | null> {
  if (!oauthConfig) return null
  let identity: QuickBooksAccountIdentity
  try {
    identity = parseQuickBooksAccountId(accountId)
  } catch {
    return null
  }
  if (identity.appKey !== expectedAppKey) return null
  try {
    const config = await decryptQuickBooksOAuthClientConfig(oauthConfig)
    if (deriveQuickBooksWebhookAppKey(config) !== expectedAppKey) return null
    return config
  } catch (error) {
    if (error instanceof QuickBooksOAuthClientConfigurationError) return null
    throw error
  }
}

/**
 * Yields every distinct verifier token configured for the Intuit app addressed by its non-secret
 * route key, decrypting one account at a time so a caller that stops at the first match never pays
 * for the whole app's fan-out.
 */
export async function* streamQuickBooksWebhookVerifierTokensByAppKey(
  appKey: string
): AsyncGenerator<string> {
  const normalizedAppKey = normalizeQuickBooksWebhookAppKey(appKey)
  const rows = await db
    .select({
      accountId: account.accountId,
      oauthConfig: account.oauthConfig,
    })
    .from(account)
    .where(
      and(
        eq(account.providerId, 'quickbooks'),
        like(account.accountId, buildQuickBooksWebhookAccountIdPattern(normalizedAppKey))
      )
    )
    .limit(MAX_QUICKBOOKS_WEBHOOK_APP_ACCOUNTS + 1)

  if (rows.length > MAX_QUICKBOOKS_WEBHOOK_APP_ACCOUNTS) {
    throw new Error('QuickBooks webhook app account limit exceeded')
  }

  const yieldedTokens = new Set<string>()
  for (const row of rows) {
    const config = await decryptValidatedClientConfig(
      row.accountId,
      row.oauthConfig,
      normalizedAppKey
    )
    const verifierToken = config?.webhookVerifierToken
    if (!verifierToken || yieldedTokens.has(verifierToken)) continue
    yieldedTokens.add(verifierToken)
    yield verifierToken
  }
}

/** Loads the user-owned Intuit app configuration behind one QuickBooks OAuth credential. */
export async function getQuickBooksWebhookClientConfigByCredentialId(
  credentialId: string
): Promise<QuickBooksWebhookCredentialContext | null> {
  const [row] = await db
    .select({
      accountId: account.accountId,
      oauthConfig: account.oauthConfig,
    })
    .from(credential)
    .innerJoin(account, eq(account.id, credential.accountId))
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.type, 'oauth'),
        eq(credential.providerId, 'quickbooks'),
        eq(account.providerId, 'quickbooks')
      )
    )
    .limit(1)

  if (!row) return null
  let identity: QuickBooksAccountIdentity
  try {
    identity = parseQuickBooksAccountId(row.accountId)
  } catch {
    return null
  }
  const clientConfig = await decryptValidatedClientConfig(
    row.accountId,
    row.oauthConfig,
    identity.appKey
  )
  return clientConfig ? { clientConfig, identity } : null
}

/** Routes one Intuit app's event to only the matching connected company. */
export function buildQuickBooksWebhookRoutingKey(appKey: string, realmId: string): string {
  return `${normalizeQuickBooksWebhookAppKey(appKey)}:${normalizeQuickBooksRealmId(realmId)}`
}
