import { describe, expect, it } from 'vitest'
import { V2_OAUTH_CONNECTION_PROVIDER_IDS } from '@/lib/api/contracts/v2/credentials'
import { getAllOAuthServices } from '@/lib/oauth/utils'

describe('V2_OAUTH_CONNECTION_PROVIDER_IDS', () => {
  it('keeps the documented provider enum in sync with provider discovery', () => {
    const discoveredProviderIds = getAllOAuthServices()
      .filter((service) => service.authType === 'oauth')
      .flatMap((service) => [service.providerId, ...(service.additionalProviderIds ?? [])])

    expect(V2_OAUTH_CONNECTION_PROVIDER_IDS).toEqual(discoveredProviderIds)
  })
})
