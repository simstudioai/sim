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
import { SHOPIFY_API_VERSION } from '@/tools/shopify/constants'

/**
 * SSRF guard: the Admin API must target the permanent `*.myshopify.com`
 * host — exactly one label before `myshopify.com`, so lookalike hosts such as
 * `sub.myshopify.com.evil.com` are rejected before any outbound fetch.
 */
const SHOPIFY_HOST_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

const SHOP_QUERY = '{ shop { name myshopifyDomain } }'

interface ShopifyGraphqlError {
  message?: string
  extensions?: { code?: string }
}

interface ShopifyShopResponse {
  data?: {
    shop?: {
      name?: string
      myshopifyDomain?: string
    }
  }
  errors?: ShopifyGraphqlError[] | unknown
}

/**
 * Shopify can reject invalid or revoked `shpat_` tokens with HTTP 200 and a
 * GraphQL error body instead of a 401, so auth-shaped GraphQL errors must map
 * to `invalid_credentials` rather than a provider outage.
 */
function hasShopifyAuthError(errors: unknown): boolean {
  if (!Array.isArray(errors)) return false
  return errors.some((error: ShopifyGraphqlError) => {
    const haystack = `${error?.message ?? ''} ${error?.extensions?.code ?? ''}`
    return /access.?denied|unauthorized|invalid api key or access token|401/i.test(haystack)
  })
}

/** Strips the protocol and trailing slashes and lowercases the store domain. */
function normalizeShopifyDomain(rawDomain: string): string {
  return rawDomain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
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
  if (hasShopifyAuthError(payload.errors)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 401, {
      step: 'shop_query',
      domain,
      reason: 'auth-shaped GraphQL error in 200 response',
    })
  }
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
