/**
 * Tests for the inactivity-alert polling cron route.
 *
 * @vitest-environment node
 */
import { createMockRequest, redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockPollInactivityAlerts } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockPollInactivityAlerts: vi.fn().mockResolvedValue({ checked: 0, delivered: 0 }),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

vi.mock('@/lib/notifications/inactivity-polling', () => ({
  pollInactivityAlerts: mockPollInactivityAlerts,
}))

import { GET } from './route'

function createRequest() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/notifications/poll')
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('inactivity alert polling route (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
    mockPollInactivityAlerts.mockResolvedValue({ checked: 0, delivered: 0 })
  })

  it('returns the auth error when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValueOnce(new Response(null, { status: 401 }) as never)

    const response = await GET(createRequest())

    expect(response.status).toBe(401)
    expect(mockPollInactivityAlerts).not.toHaveBeenCalled()
  })

  it('acknowledges with 202 and polls in the background after acquiring the lock', async () => {
    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'started' })
    expect(redisConfigMockFns.mockAcquireLock).toHaveBeenCalledWith(
      'inactivity-alert-polling-lock',
      expect.any(String),
      expect.any(Number)
    )

    await flushMicrotasks()
    expect(mockPollInactivityAlerts).toHaveBeenCalledTimes(1)
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'inactivity-alert-polling-lock',
      expect.any(String)
    )
  })

  it('skips with 202 when the lock is already held', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'skip' })
    expect(mockPollInactivityAlerts).not.toHaveBeenCalled()
  })

  it('releases the lock even when polling throws', async () => {
    mockPollInactivityAlerts.mockRejectedValueOnce(new Error('poll failed'))

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    await flushMicrotasks()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'inactivity-alert-polling-lock',
      expect.any(String)
    )
  })
})
