/**
 * Tests for the Teams subscription renewal cron route.
 *
 * @vitest-environment node
 */
import {
  authOAuthUtilsMock,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  redisConfigMock,
  redisConfigMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)

import { GET } from './route'

function createRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/renew-subscriptions'
  )
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Teams subscription renewal route (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
  })

  it('returns the auth error when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValueOnce(new Response(null, { status: 401 }) as never)

    const response = await GET(createRequest())

    expect(response.status).toBe(401)
    expect(redisConfigMockFns.mockAcquireLock).not.toHaveBeenCalled()
  })

  it('acknowledges with 202 and renews in the background after acquiring the lock', async () => {
    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'started' })
    expect(redisConfigMockFns.mockAcquireLock).toHaveBeenCalledWith(
      'teams-subscription-renewal-lock',
      expect.any(String),
      expect.any(Number)
    )

    await flushMicrotasks()
    expect(dbChainMockFns.select).toHaveBeenCalled()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'teams-subscription-renewal-lock',
      expect.any(String)
    )
  })

  it('skips with 202 when the lock is already held', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'skip' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
