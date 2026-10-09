import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import { TOKEN_REFRESH_TIMEOUT_MS } from '@/lib/oauth/oauth'
import {
  clearOAuthRefreshDeadFlag,
  getOAuthRefreshCoordinationIdentity,
} from '@/lib/oauth/refresh-coordination'
import {
  getRecentTerminalError,
  isTerminalRefreshError,
  markCredentialDead,
} from '@/lib/oauth/terminal-errors'
import { SHOPIFY_API_VERSION } from '@/tools/shopify/constants'

const logger = createLogger('ShopifyInstallation')

interface ShopifyTokenChain {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
  scope?: string
}

/** Safe callback diagnostics; provider response bodies can contain live tokens. */
export class ShopifyOAuthError extends Error {
  constructor(
    message: string,
    readonly callbackError: 'shopify_token_error' | 'shopify_no_token' | 'shopify_callback_error',
    readonly errorCode?: string
  ) {
    super(message)
    this.name = 'ShopifyOAuthError'
  }
}

function normalizeShopDomain(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/i.test(value)) {
    throw new ShopifyOAuthError('Invalid Shopify shop domain', 'shopify_callback_error')
  }
  return value.toLowerCase()
}

/** Installation identity shared by connect, refresh, and terminal-error lookup. */
export function getShopifyRefreshScope(shopDomain: string): string {
  const { values } = requireConfiguredOAuthClient('shopify')
  return `shopify:${values.SHOPIFY_CLIENT_ID}:${normalizeShopDomain(shopDomain)}`
}

function tokenExpiry(value: unknown, issuedAt: number): Date {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ShopifyOAuthError('Invalid Shopify token response expiry', 'shopify_token_error')
  }
  const expiry = new Date(issuedAt + value * 1000)
  if (!Number.isFinite(expiry.getTime())) {
    throw new ShopifyOAuthError('Invalid Shopify token response expiry', 'shopify_token_error')
  }
  return expiry
}

async function readShopifyResponse(
  response: Response,
  requestSignal: AbortSignal,
  callerSignal?: AbortSignal
): Promise<Record<string, unknown>> {
  try {
    return toRecord(
      await readResponseJsonWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Shopify OAuth response',
        signal: requestSignal,
      })
    )
  } catch {
    callerSignal?.throwIfAborted()
    throw new ShopifyOAuthError('Invalid Shopify OAuth response', 'shopify_token_error')
  }
}

async function exchangeToken(
  shopDomain: string,
  grant: { code: string } | { refresh_token: string },
  signal?: AbortSignal
): Promise<ShopifyTokenChain> {
  const { values } = requireConfiguredOAuthClient('shopify')
  const issuedAt = Date.now()
  const timeout = AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: values.SHOPIFY_CLIENT_ID,
        client_secret: values.SHOPIFY_CLIENT_SECRET,
        ...grant,
        ...('code' in grant ? { expiring: '1' } : { grant_type: 'refresh_token' }),
      }),
      redirect: 'error',
      signal: requestSignal,
    })
  } catch {
    signal?.throwIfAborted()
    throw new ShopifyOAuthError('Shopify token response unavailable', 'shopify_token_error')
  }
  const data = await readShopifyResponse(response, requestSignal, signal)
  if (!response.ok) {
    const errorCode =
      'refresh_token' in grant && response.status === 401 && data.error === 'invalid_request'
        ? 'invalid_grant'
        : data.error === 'invalid_client'
          ? 'invalid_client'
          : undefined
    throw new ShopifyOAuthError(
      `Shopify token response rejected (${response.status})`,
      'shopify_token_error',
      errorCode
    )
  }
  if (typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new ShopifyOAuthError('Invalid Shopify token response access token', 'shopify_no_token')
  }
  if (
    typeof data.refresh_token !== 'string' ||
    !data.refresh_token.trim() ||
    (data.scope !== undefined && typeof data.scope !== 'string') ||
    ('code' in grant && typeof data.scope !== 'string')
  ) {
    throw new ShopifyOAuthError('Invalid Shopify token response', 'shopify_token_error')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: tokenExpiry(data.expires_in, issuedAt),
    refreshTokenExpiresAt: tokenExpiry(data.refresh_token_expires_in, issuedAt),
    ...(typeof data.scope === 'string' ? { scope: data.scope } : {}),
  }
}

async function fetchShopAccountId(
  shopDomain: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<string> {
  const timeout = AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query ShopifyOAuthIdentity { shop { id } }' }),
      redirect: 'error',
      signal: requestSignal,
    }
  )
  const payload = await readShopifyResponse(response, requestSignal, signal)
  const shop = toRecord(toRecord(payload.data).shop)
  const id =
    typeof shop.id === 'string' ? /^gid:\/\/shopify\/Shop\/(\d+)$/.exec(shop.id)?.[1] : undefined
  if (!response.ok || payload.errors || !id) {
    throw new ShopifyOAuthError('Invalid Shopify shop response', 'shopify_callback_error')
  }
  return id
}

/** Acquires and saves one rotating chain while retaining each user's existing account row. */
export async function connectShopifyInstallation(params: {
  code: string
  shopDomain: string
  userId: string
  signal?: AbortSignal
}): Promise<string> {
  const shopDomain = normalizeShopDomain(params.shopDomain)
  const scope = getShopifyRefreshScope(shopDomain)
  return db.transaction(async (tx) => {
    await acquireAdvisoryXactLock(tx, 'shopify_oauth', getOAuthRefreshCoordinationIdentity(scope))
    const identities = await tx
      .selectDistinct({ accountId: account.accountId })
      .from(account)
      .where(and(eq(account.providerId, 'shopify'), sql`lower(${account.idToken}) = ${shopDomain}`))
      .limit(2)
    const verifiedShopId = identities[0]?.accountId
    if (identities.length > 1 || (verifiedShopId !== undefined && !/^\d+$/.test(verifiedShopId))) {
      throw new ShopifyOAuthError(
        'Shopify installation identity is inconsistent',
        'shopify_callback_error'
      )
    }
    const findUserAccount = (shopId: string) =>
      tx.query.account.findFirst({
        where: and(
          eq(account.providerId, 'shopify'),
          eq(account.accountId, shopId),
          eq(account.userId, params.userId)
        ),
        columns: { id: true },
      })
    const verifiedAccount = verifiedShopId ? await findUserAccount(verifiedShopId) : undefined
    const chain = await exchangeToken(shopDomain, { code: params.code }, params.signal)
    const shopId =
      verifiedShopId ?? (await fetchShopAccountId(shopDomain, chain.accessToken, params.signal))
    const installation = and(eq(account.providerId, 'shopify'), eq(account.accountId, shopId))
    const existing = verifiedShopId ? verifiedAccount : await findUserAccount(shopId)
    const now = new Date()
    const data = { ...chain, idToken: shopDomain, updatedAt: now }
    await tx.update(account).set(data).where(installation)
    const accountId = existing?.id ?? generateId()
    if (!existing) {
      await tx.insert(account).values({
        id: accountId,
        accountId: shopId,
        providerId: 'shopify',
        userId: params.userId,
        ...data,
        createdAt: now,
      })
    }
    try {
      await clearOAuthRefreshDeadFlag(scope)
    } catch {
      logger.warn('Shopify terminal-error flag could not be cleared')
    }
    return accountId
  })
}

/** Refreshes the persisted installation chain under the same lock as OAuth code acquisition. */
export async function refreshShopifyInstallation(accountId: string): Promise<string | null> {
  try {
    const initial = await db.query.account.findFirst({
      where: and(eq(account.id, accountId), eq(account.providerId, 'shopify')),
      columns: { idToken: true },
    })
    if (!initial?.idToken) return null
    const shopDomain = normalizeShopDomain(initial.idToken)
    const scope = getShopifyRefreshScope(shopDomain)
    const identity = getOAuthRefreshCoordinationIdentity(scope)
    return await db.transaction(async (tx) => {
      await acquireAdvisoryXactLock(tx, 'shopify_oauth', identity)
      const stored = await tx.query.account.findFirst({
        where: and(eq(account.id, accountId), eq(account.providerId, 'shopify')),
      })
      if (!stored || stored.idToken?.toLowerCase() !== shopDomain) return null
      if (
        stored.accessToken &&
        (!stored.accessTokenExpiresAt ||
          stored.accessTokenExpiresAt.getTime() > Date.now() + 300_000)
      ) {
        return stored.accessToken
      }
      if (!stored.refreshToken || (await getRecentTerminalError(identity))) return null
      if (stored.refreshTokenExpiresAt && stored.refreshTokenExpiresAt.getTime() <= Date.now()) {
        await markCredentialDead(identity, 'invalid_grant')
        return null
      }
      let chain: ShopifyTokenChain
      try {
        chain = await exchangeToken(shopDomain, { refresh_token: stored.refreshToken })
      } catch (error) {
        if (error instanceof ShopifyOAuthError && isTerminalRefreshError(error.errorCode)) {
          await markCredentialDead(identity, error.errorCode ?? 'invalid_grant')
        }
        return null
      }
      await tx
        .update(account)
        .set({ ...chain, updatedAt: new Date() })
        .where(and(eq(account.providerId, 'shopify'), eq(account.accountId, stored.accountId)))
      return chain.accessToken
    })
  } catch {
    logger.warn('Shopify installation token refresh unavailable')
    return null
  }
}
