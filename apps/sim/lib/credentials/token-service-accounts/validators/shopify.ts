import {
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'

/**
 * Pinned to match the Admin API version hardcoded in every Sim Shopify tool
 * (`apps/sim/tools/shopify/*`) — bump both together. Note 2024-10 is retired;
 * Shopify silently serves the oldest supported version for retired versions,
 * so validation and tool runtime still hit the same effective API.
 */
const SHOPIFY_API_VERSION = '2024-10'

/**
 * SSRF guard: the Admin API must target the permanent `*.myshopify.com`
 * host — exactly one label before `myshopify.com`, so lookalike hosts such as
 * `sub.myshopify.com.evil.com` are rejected before any outbound fetch.
 */
const SHOPIFY_HOST_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

const SHOP_QUERY = '{ shop { name myshopifyDomain } }'

interface ShopifyShopResponse {
  data?: {
    shop?: {
      name?: string
      myshopifyDomain?: string
    }
  }
  errors?: unknown
}

/** Strips the protocol and trailing slashes and lowercases the store domain. */
function normalizeShopifyDomain(rawDomain: string): string {
  return rawDomain
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * Validates a Shopify custom-app Admin API access token by running the
 * scope-free `shop` query against the store's GraphQL Admin API — the exact
 * URL and header shape every Sim Shopify tool uses. Unknown shops return 404
 * (wildcard DNS means the host always resolves), which maps to
 * `site_not_found`.
 */
export async function validateShopifyServiceAccount(
  fields: TokenServiceAccountFields
): Promise<TokenServiceAccountValidationResult> {
  const domain = normalizeShopifyDomain(fields.domain ?? '')
  if (!SHOPIFY_HOST_REGEX.test(domain)) {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      domain,
      reason: 'host is not a Shopify store domain (expected *.myshopify.com)',
    })
  }

  const res = await fetchProvider(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': fields.apiToken,
      },
      body: JSON.stringify({ query: SHOP_QUERY }),
    },
    'shop_query'
  )

  if (res.status === 404) {
    throw new TokenServiceAccountValidationError('site_not_found', 404, {
      step: 'shop_query',
      domain,
      body: await readProviderErrorSnippet(res),
    })
  }
  await throwForProviderResponse(res, 'shop_query', { domain })

  const payload = await parseProviderJson<ShopifyShopResponse>(res, 'shop_query')

  const shop = payload.data?.shop
  if (payload.errors || !shop) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: 'shop_query',
      domain,
      reason: payload.errors ? 'GraphQL errors in response' : 'missing shop in response',
    })
  }

  const shopName = typeof shop.name === 'string' && shop.name ? shop.name : undefined
  const apiDomain =
    typeof shop.myshopifyDomain === 'string'
      ? normalizeShopifyDomain(shop.myshopifyDomain)
      : undefined
  const canonicalDomain = apiDomain && SHOPIFY_HOST_REGEX.test(apiDomain) ? apiDomain : domain
  const storedMetadata: Record<string, string> = { shopDomain: canonicalDomain }
  if (shopName) storedMetadata.shopName = shopName

  return {
    displayName: shopName ?? canonicalDomain,
    auditMetadata: { shopifyShopDomain: canonicalDomain },
    storedMetadata,
    normalizedDomain: canonicalDomain,
  }
}
