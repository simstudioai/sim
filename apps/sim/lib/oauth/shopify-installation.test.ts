import { databaseMock, resetDbChainMock } from '@sim/testing'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)

import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { refreshShopifyInstallation } from '@/lib/oauth/shopify-installation'

const shopDomain = 'fixture.myshopify.com'
const findFirst = vi.fn()
const redis = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') }

Object.assign(databaseMock.db.query, { account: { findFirst } })
setEnv({ SHOPIFY_CLIENT_ID: 'shopify-client', SHOPIFY_CLIENT_SECRET: 'shopify-secret' })
afterAll(resetEnvMock)

beforeEach(() => {
  resetDbChainMock()
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  findFirst.mockResolvedValue({
    id: 'account-1',
    accountId: '123456789012345',
    idToken: shopDomain,
    accessToken: 'expired-access',
    accessTokenExpiresAt: new Date(Date.now() - 60_000),
    refreshToken: 'stored-refresh',
    refreshTokenExpiresAt: null,
  })
  networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
  networkConfigMockFns.mockResolveOutboundRoute.mockRejectedValue(
    new OutboundRoutingError('GATEWAY_UNAVAILABLE')
  )
})

describe('refreshShopifyInstallation', () => {
  it('surfaces an unavailable egress route instead of a null (failed) refresh', async () => {
    await expect(
      runWithOutboundOrganization('organization-1', () => refreshShopifyInstallation('account-1'))
    ).rejects.toBeInstanceOf(OutboundRoutingError)
  })
})
