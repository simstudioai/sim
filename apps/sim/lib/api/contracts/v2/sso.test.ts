import { describe, expect, it } from 'vitest'
import { v2SaveSsoProviderContract } from '@/lib/api/contracts/v2/sso'

describe('v2 save SSO provider contract', () => {
  const body = {
    providerType: 'oidc',
    domain: 'acme.com',
    issuer: 'https://idp.acme.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  }

  it.each(['acme%2Fidp', 'acme/idp', 'acme idp', '.', '..'])(
    'rejects a provider ID that does not survive a URL path unchanged (%s)',
    (providerId) => {
      expect(v2SaveSsoProviderContract.body?.safeParse({ ...body, providerId }).success).toBe(false)
    }
  )
})
