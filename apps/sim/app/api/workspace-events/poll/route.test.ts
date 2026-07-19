/**
 * Tests for the workspace-events no-activity polling cron route.
 *
 * @vitest-environment node
 */
import { createMockRequest, redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVerifyCronAuth, mockPollNoActivityEvents } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn().mockReturnValue(null),
  mockPollNoActivityEvents: vi
    .fn()
    .mockResolvedValue({ subscriptions: 0, checked: 0, fired: 0, skipped: 0 }),
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

vi.mock('@/lib/workspace-events/no-activity', () => ({
  pollNoActivityEvents: mockPollNoActivityEvents,
}))

import { GET } from './route'

function createRequest() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspace-events/poll')
}

const flushMicrotasks = () => sleep(0)

describe('workspace events polling route (fire-and-forget)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
    mockVerifyCronAuth.mockReturnValue(null)
    mockPollNoActivityEvents.mockResolvedValue({
      subscriptions: 0,
      checked: 0,
      fired: 0,
      skipped: 0,
    })
  })

  it('returns the auth error when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValueOnce(new Response(null, { status: 401 }) as never)

    const response = await GET(createRequest())

    expect(response.status).toBe(401)
    expect(mockPollNoActivityEvents).not.toHaveBeenCalled()
  })

  it('acknowledges with 202 and polls in the background after acquiring the lock', async () => {
    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'started' })
    expect(redisConfigMockFns.mockAcquireLock).toHaveBeenCalledWith(
      'workspace-events-no-activity-poll-lock',
      expect.any(String),
      expect.any(Number)
    )

    await flushMicrotasks()
    expect(mockPollNoActivityEvents).toHaveBeenCalledTimes(1)
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'workspace-events-no-activity-poll-lock',
      expect.any(String)
    )
  })

  it('skips with 202 when the lock is already held', async () => {
    redisConfigMockFns.mockAcquireLock.mockResolvedValueOnce(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    const data = await response.json()
    expect(data).toMatchObject({ status: 'skip' })
    expect(mockPollNoActivityEvents).not.toHaveBeenCalled()
  })

  it('releases the lock even when polling throws', async () => {
    mockPollNoActivityEvents.mockRejectedValueOnce(new Error('poll failed'))

    const response = await GET(createRequest())

    expect(response.status).toBe(202)
    await flushMicrotasks()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'workspace-events-no-activity-poll-lock',
      expect.any(String)
    )
  })
})
