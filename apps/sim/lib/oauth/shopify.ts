import { createLogger } from '@sim/logger'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { upsertProviderAccountTokens } from '@/lib/oauth/credential-service'
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

  const { accountId } = await upsertProviderAccountTokens({
    userId: params.userId,
    providerId: 'shopify',
    externalAccountId: stableAccountId,
    scope: params.scope ?? '',
    /** Shopify has no refresh token; `idToken` carries the shop domain, not a JWT. */
    tokens: { accessToken: params.accessToken, idToken: params.shopDomain },
    logIdentifier: params.shopDomain,
  })

  await processCredentialDraft({
    draftId: params.draftId,
    userId: params.userId,
    providerId: 'shopify',
    accountId,
  })
}
