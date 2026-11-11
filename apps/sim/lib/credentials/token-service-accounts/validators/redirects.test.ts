import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import { mintBoxServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/box'
import type {
  TokenServiceAccountFields,
  TokenServiceAccountValidationResult,
} from '@/lib/credentials/token-service-accounts/server'
import { validateClaudePlatformServiceAccount } from '@/lib/credentials/token-service-accounts/validators/claude-platform'
import { validateShopifyServiceAccount } from '@/lib/credentials/token-service-accounts/validators/shopify'

/**
 * Fetch keeps custom headers such as `x-api-key` on a cross-origin redirect (it
 * strips only `Authorization`), so a check that followed one would hand the key to
 * whatever host the redirect names. This fetch answers the way a redirect would:
 * refused when the check asks for that, otherwise served by the redirect target,
 * which here accepts anything.
 */
function redirectingFetch(targetAnswer: unknown) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect')
    return jsonResponse(targetAnswer)
  })
}

describe('saved key checks that send the key in a custom header', () => {
  it.each<
    [
      string,
      (fields: TokenServiceAccountFields) => Promise<TokenServiceAccountValidationResult>,
      TokenServiceAccountFields,
      unknown,
    ]
  >([
    ['Claude Platform', validateClaudePlatformServiceAccount, { apiToken: 'sk-ant-key' }, {}],
    [
      'Shopify',
      validateShopifyServiceAccount,
      { apiToken: 'shpat_key', domain: 'acme.myshopify.com' },
      { data: { shop: { name: 'Elsewhere', myshopifyDomain: 'acme.myshopify.com' } } },
    ],
  ])('%s refuses to follow a redirect with the key', async (_vendor, validate, fields, answer) => {
    vi.stubGlobal('fetch', redirectingFetch(answer))

    await expect(validate(fields)).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

describe('client-credential mints that send the secret in the request body', () => {
  it('Box refuses to replay its client secret to a redirect target', async () => {
    vi.stubGlobal('fetch', redirectingFetch({ access_token: 'elsewhere', expires_in: 3600 }))

    await expect(
      mintBoxServiceAccountToken({ clientId: 'box-cid', clientSecret: 'box-secret', orgId: '1' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
