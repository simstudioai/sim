/**
 * Tests for the webhook polling cron route.
 */
import { createMockRequest, redisConfigMockFns } from '@sim/testing'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPollProvider } = vi.hoisted(() => ({
  mockPollProvider: vi.fn().mockResolvedValue({ processed: 0 }),
}))

vi.mock('@/lib/auth/internal', () => authInternalMock)

vi.mock('@/lib/webhooks/polling', () => ({
  pollProvider: mockPollProvider,
  VALID_POLLING_PROVIDERS: new Set(['gmail', 'outlook', 'rss']),
}))

import { GET } from './route'

const { mockVerifyCronAuth } = authInternalMockFns
mockVerifyCronAuth.mockReturnValue(null)

function createRequest() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/webhooks/poll/gmail')
}

function createContext(provider: string) {
  return { params: Promise.resolve({ provider }) }
}

describe('webhook polling route (fire-and-forget)', () => {
  beforeEach(() => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
    mockPollProvider.mockResolvedValue({ processed: 0 })
  })

  it('skips with 202 when the lock is already held', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    const response = await GET(createRequest(), createContext('gmail'))

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'skip' })
    expect(mockPollProvider).not.toHaveBeenCalled()
  })

  it('releases the lock even when polling throws', async () => {
    mockPollProvider.mockRejectedValueOnce(new Error('poll failed'))

    const response = await GET(createRequest(), createContext('gmail'))

    expect(response.status).toBe(202)
    await flushMacrotask()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'gmail-polling-lock',
      expect.any(String)
    )
  })
})
