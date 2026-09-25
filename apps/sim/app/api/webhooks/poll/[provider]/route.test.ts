/**
 * Tests for the webhook polling cron route.
 */
import { createMockRequest, redisConfigMockFns } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockPollProvider } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockPollProvider: vi.fn().mockResolvedValue({ processed: 0 }),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/lib/webhooks/polling', () => ({
  pollProvider: mockPollProvider,
  VALID_POLLING_PROVIDERS: new Set(['gmail', 'outlook', 'rss']),
}))

import { GET } from './route'

function createRequest() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/webhooks/poll/gmail')
}

function createContext(provider: string) {
  return { params: Promise.resolve({ provider }) }
}

const flushMicrotasks = () => sleep(0)

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
    await flushMicrotasks()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'gmail-polling-lock',
      expect.any(String)
    )
  })
})
