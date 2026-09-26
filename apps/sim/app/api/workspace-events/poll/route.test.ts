/**
 * Tests for the workspace-events no-activity polling cron route.
 */
import { createMockRequest, redisConfigMockFns } from '@sim/testing'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPollNoActivityEvents } = vi.hoisted(() => ({
  mockPollNoActivityEvents: vi
    .fn()
    .mockResolvedValue({ subscriptions: 0, checked: 0, fired: 0, skipped: 0 }),
}))

vi.mock('@/lib/auth/internal', () => authInternalMock)

vi.mock('@/lib/workspace-events/no-activity', () => ({
  pollNoActivityEvents: mockPollNoActivityEvents,
}))

import { GET } from './route'

const { mockVerifyCronAuth } = authInternalMockFns
mockVerifyCronAuth.mockReturnValue(null)

function createRequest() {
  return createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workspace-events/poll')
}

describe('workspace events polling route (fire-and-forget)', () => {
  beforeEach(() => {
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
    await flushMacrotask()
    expect(redisConfigMockFns.mockReleaseLock).toHaveBeenCalledWith(
      'workspace-events-no-activity-poll-lock',
      expect.any(String)
    )
  })
})
