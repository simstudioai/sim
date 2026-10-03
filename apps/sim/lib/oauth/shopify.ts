import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { safeAccountInsert } from '@/lib/oauth/credential-service'
import { SHOPIFY_API_VERSION } from '@/tools/shopify/constants'

const logger = createLogger('ShopifyOAuth')

interface CompleteShopifyOAuthConnectionParams {
  accessToken: string
  shopDomain: string
  scope?: string
  userId: string
  draftId?: string
  signal?: AbortSignal
}

function getShopifyAccountId(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new Error('Shopify shop response must be an object')
  }
  const shop = (value as { shop?: unknown }).shop
  if (!shop || typeof shop !== 'object') {
    throw new Error('Shopify shop response is missing shop data')
  }
  const id = (shop as { id?: unknown }).id
  if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length === 0) {
    throw new Error('Shopify shop response is missing its account id')
  }
  return String(id)
}

/** Persists a verified Shopify account and completes its exact credential draft. */
export async function completeShopifyOAuthConnection(
  params: CompleteShopifyOAuthConnectionParams
): Promise<void> {
  const shopResponse = await fetch(
    `https://${params.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
    {
      headers: {
        'X-Shopify-Access-Token': params.accessToken,
        'Content-Type': 'application/json',
      },
      signal: params.signal,
    }
  )

  if (!shopResponse.ok) {
    const errorText = await shopResponse.text()
    throw new Error(`Shopify token validation failed (${shopResponse.status}): ${errorText}`)
  }

  const stableAccountId = getShopifyAccountId(await shopResponse.json())
  const existing = await db.query.account.findFirst({
    where: and(
      eq(account.userId, params.userId),
      eq(account.providerId, 'shopify'),
      eq(account.accountId, stableAccountId)
    ),
  })

  const now = new Date()
  const accountData = {
    accessToken: params.accessToken,
    accountId: stableAccountId,
    scope: params.scope ?? '',
    updatedAt: now,
    idToken: params.shopDomain,
  }

  if (existing) {
    await db.update(account).set(accountData).where(eq(account.id, existing.id))
    logger.info('Updated existing Shopify account', { accountId: existing.id })
  } else {
    await safeAccountInsert(
      {
        id: generateId(),
        userId: params.userId,
        providerId: 'shopify',
        accountId: accountData.accountId,
        accessToken: accountData.accessToken,
        scope: accountData.scope,
        idToken: accountData.idToken,
        createdAt: now,
        updatedAt: now,
      },
      { provider: 'Shopify', identifier: params.shopDomain }
    )
  }

  const persisted =
    existing ??
    (await db.query.account.findFirst({
      where: and(
        eq(account.userId, params.userId),
        eq(account.providerId, 'shopify'),
        eq(account.accountId, stableAccountId)
      ),
    }))

  if (!persisted) {
    throw new Error(`Shopify OAuth account ${stableAccountId} was not persisted`)
  }

  await processCredentialDraft({
    draftId: params.draftId,
    userId: params.userId,
    providerId: 'shopify',
    accountId: persisted.id,
  })
}
