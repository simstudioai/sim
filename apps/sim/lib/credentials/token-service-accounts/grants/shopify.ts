import { isRecordLike } from '@sim/utils/object'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { resolveCoordinatedClientToken } from '@/lib/credentials/coordinated-client-token'
import type {
  TokenClientCredentialFields,
  TokenClientCredentialMint,
} from '@/lib/credentials/token-service-accounts/client-credentials'
import {
  fetchProvider,
  providerFailureCode,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  normalizeShopifyDomain,
  SHOPIFY_HOST_REGEX,
} from '@/lib/credentials/token-service-accounts/validators/shopify'

const STEP = 'shopify_token_mint'
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
/** Shopify documents a fixed 24-hour lifetime (`expires_in` is always 86399). */
const MAX_TOKEN_LIFETIME_SECONDS = 86_400

async function exchangeShopifyToken(
  shop: string,
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; expiresAt: Date }> {
  const startedAt = Date.now()
  const response = await fetchProvider(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // Shopify ignores `scope` on this grant; the token carries every scope the store granted.
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      redirect: 'error',
      cache: 'no-store',
      signal,
    },
    STEP,
    { dnsFailureCode: 'site_not_found', dnsFailureReason: 'store domain does not resolve' }
  )
  if (!response.ok) {
    const body = await readProviderErrorSnippet(response)
    if (/shop_not_permitted/i.test(body)) {
      throw new TokenServiceAccountValidationError('grant_not_permitted', response.status, {
        step: STEP,
        domain: shop,
        reason: 'app and store are not in the same Shopify organization',
      })
    }
    throw new TokenServiceAccountValidationError(
      response.status === 404 ? 'site_not_found' : providerFailureCode(response.status),
      response.status,
      { step: STEP, domain: shop, reason: 'provider rejected token exchange' }
    )
  }
  let payload: unknown
  try {
    payload = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_TOKEN_RESPONSE_BYTES,
      label: 'Shopify token response',
      signal,
    })
  } catch {
    signal?.throwIfAborted()
    payload = undefined
  }
  if (
    !isRecordLike(payload) ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token.trim() ||
    typeof payload.expires_in !== 'number' ||
    !Number.isSafeInteger(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw new TokenServiceAccountValidationError('provider_unavailable', 502, {
      step: STEP,
      reason: 'provider returned an invalid token response',
    })
  }
  const lifetimeSeconds = Math.min(payload.expires_in, MAX_TOKEN_LIFETIME_SECONDS)
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(startedAt + lifetimeSeconds * 1000),
  }
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
    exchange: (signal) => exchangeShopifyToken(shop, clientId, fields.clientSecret, signal),
    signal: options?.signal,
  })
}
