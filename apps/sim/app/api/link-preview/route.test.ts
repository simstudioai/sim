import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { rateLimiterMock } from '@sim/testing/mocks/rate-limiter.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}))
vi.mock('@/lib/core/rate-limiter/route-helpers', () => rateLimiterMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: async () => ({
    success: true,
    data: { query: { url: 'https://example.com/guide' } },
  }),
}))
vi.mock('@/lib/core/network/context.server', () => ({
  runWithOutboundOrganization: (_organization: null, run: () => unknown) => run(),
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))
vi.mock('@/lib/link-preview/fetch-preview', () => ({ fetchLinkPreview: mocks.fetch }))

import { GET } from '@/app/api/link-preview/route'

const complete = { title: 'Guide', description: null, siteName: null }

describe('link preview cache lifetime', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'test-user' } })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(mocks)
    mocks.get.mockResolvedValue(null)
    mocks.set.mockResolvedValue('OK')
  })

  it.each([
    { preview: { ...complete, imageRetryable: true }, ttl: 60 },
    { preview: complete, ttl: 24 * 60 * 60 },
    { preview: null, ttl: 60 * 60 },
  ])('caches $preview for $ttl seconds', async ({ preview, ttl }) => {
    mocks.fetch.mockResolvedValue(preview)
    const response = await GET(new NextRequest('https://example.com/api/link-preview'))
    expect(await response.json()).toEqual({ preview })
    expect(mocks.set).toHaveBeenCalledWith(expect.any(String), JSON.stringify(preview), 'EX', ttl)
  })
})
