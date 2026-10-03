/**
 * Tests for the Teams subscription renewal cron route.
 */
import {
  authOAuthUtilsMock,
  createMockRequest,
  dbChainMockFns,
  redisConfigMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/internal', () => authInternalMock)

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

import { GET } from './route'

const mockVerifyCronAuth = authInternalMockFns.mockVerifyCronAuth

function createRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/renew-subscriptions'
  )
}

describe('Teams subscription renewal route (fire-and-forget)', () => {
  beforeEach(() => {
    resetDbChainMock()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
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
