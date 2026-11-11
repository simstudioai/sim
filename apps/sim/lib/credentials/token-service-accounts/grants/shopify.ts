import { exchangeClientCredentialsGrant } from '@/lib/credentials/client-credentials-grant'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import type {
  TokenClientCredentialFields,
  TokenClientCredentialMint,
} from '@/lib/credentials/token-service-accounts/client-credentials'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  normalizeShopifyDomain,
  SHOPIFY_HOST_REGEX,
} from '@/lib/credentials/token-service-accounts/validators/shopify'

const STEP = 'shopify_token_mint'
/** Shopify documents a fixed 24-hour lifetime (`expires_in` is always 86399). */
const MAX_TOKEN_LIFETIME_SECONDS = 86_400

/**
 * Shopify answers `shop_not_permitted` when the app and store are in different organizations,
 * which no secret fixes, and 404 for a store domain that does not exist.
 */
function classifyShopifyRefusal(shop: string, status: number, body: string) {
  if (/shop_not_permitted/i.test(body)) {
    return new TokenServiceAccountValidationError('grant_not_permitted', status, {
      step: STEP,
      domain: shop,
      reason: 'app and store are not in the same Shopify organization',
    })
  }
  return new TokenServiceAccountValidationError(
    status === 404 ? 'site_not_found' : providerFailureCode(status),
    status,
    { step: STEP, domain: shop, reason: 'provider rejected token exchange' }
  )
}

/**
 * Mints an Admin API token for a Dev Dashboard app installed on a store in the same Shopify
 * organization, through the client-credentials grant. Shopify documents a 24-hour lifetime but
 * not whether a new token retires earlier ones, so every saved credential for one app and store
 * shares a single coordinated token instead of minting per worker.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
export async function mintShopifyClientCredentialsToken(
  fields: TokenClientCredentialFields,
  options?: { signal?: AbortSignal }
): Promise<TokenClientCredentialMint> {
  options?.signal?.throwIfAborted()
  const shop = normalizeShopifyDomain(fields.domain ?? '')
  if (!SHOPIFY_HOST_REGEX.test(shop)) {
    throw new TokenServiceAccountValidationError('site_not_found', 400, {
      step: 'host_validation',
      domain: shop,
      reason: 'host is not a Shopify store domain (expected *.myshopify.com)',
    })
  }
  const clientId = fields.clientId.trim()
  if (!clientId || !fields.clientSecret) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: STEP,
      reason: 'client ID and client secret are required',
    })
  }
  return resolveCoordinatedClientToken({
    namespace: 'shopify',
    application: [shop, clientId],
    clientSecret: fields.clientSecret,
    step: STEP,
    exchange: (signal) =>
      exchangeClientCredentialsGrant({
        // Shopify ignores `scope` on this grant; the token carries every scope the store granted.
        url: `https://${shop}/admin/oauth/access_token`,
        clientId,
        clientSecret: fields.clientSecret,
        step: STEP,
        label: 'Shopify token response',
        maxLifetimeSeconds: MAX_TOKEN_LIFETIME_SECONDS,
        fetchOptions: {
          dnsFailureCode: 'site_not_found',
          dnsFailureReason: 'store domain does not resolve',
        },
        classifyRefusal: (status, body) => classifyShopifyRefusal(shop, status, body),
        signal,
      }),
    signal: options?.signal,
  })
}
