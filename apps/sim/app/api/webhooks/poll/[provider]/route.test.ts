/**
 * Tests for the webhook polling cron route.
 *
 * @vitest-environment node
 */
import { createMockRequest, redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockPollProvider } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockPollProvider: vi.fn().mockResolvedValue({ processed: 0 }),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

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

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('webhook polling route (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
    mockPollProvider.mockResolvedValue({ processed: 0 })
  })

  it('returns the auth error when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValueOnce(
      new Response(null, { status: 401 }) as unknown as Response
    )

    const response = await GET(createRequest(), createContext('gmail'))

    expect(response.status).toBe(401)
    expect(mockPollProvider).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown provider', async () => {
    const response = await GET(createRequest(), createContext('unknown'))

    expect(response.status).toBe(404)
    expect(redisConfigMockFns.mockAcquireLock).not.toHaveBeenCalled()
  })

  it('acknowledges with 202 and polls in the background after acquiring the lock', async () => {
    const response = await GET(createRequest(), createContext('gmail'))

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'started' })
    expect(redisConfigMockFns.mockAcquireLock).toHaveBeenCalledWith(
      'gmail-polling-lock',
      expect.any(String),
      expect.any(Number)
    )

    await flushMicrotasks()
    expect(mockPollProvider).toHaveBeenCalledWith('gmail')
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'gmail-polling-lock',
      expect.any(String)
    )
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
