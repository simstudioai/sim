import { createMockRequest } from '@sim/testing'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)

import { GET } from '@/app/api/cron/cleanup-stale-executions/route'

const { mockVerifyCronAuth } = authInternalMockFns

const mockEnqueue = asyncJobsMockFns.mockJobQueue.enqueue

function request() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost:3000/api/cron/cleanup-stale-executions'
  )
}

describe('stale execution cleanup route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T17:31:00Z'))
    mockVerifyCronAuth.mockReturnValue(null)
    mockEnqueue.mockReset()
    mockEnqueue.mockResolvedValue('job-stale-1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the cleanup to the job queue and answers without waiting for it', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ triggered: true, jobId: 'job-stale-1' })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'cleanup-stale-executions',
      {},
      expect.objectContaining({ maxAttempts: 1, concurrencyLimit: 1 })
    )
  })

  it('deduplicates retries within the same thirty-minute schedule window', async () => {
    await GET(request())
    vi.advanceTimersByTime(28 * 60 * 1000)
    await GET(request())

    expect(mockEnqueue.mock.calls[0]?.[2]?.jobId).toBe(mockEnqueue.mock.calls[1]?.[2]?.jobId)
  })

  it('uses a new id immediately after the next thirty-minute window begins', async () => {
    vi.setSystemTime(new Date('2026-10-01T17:59:59.999Z'))
    await GET(request())
    vi.setSystemTime(new Date('2026-10-01T18:00:00.000Z'))
    await GET(request())

    expect(mockEnqueue.mock.calls[0]?.[2]?.jobId).not.toBe(mockEnqueue.mock.calls[1]?.[2]?.jobId)
  })

  it('fails the cron invocation when the job cannot be enqueued', async () => {
    mockEnqueue.mockRejectedValue(new Error('queue unavailable'))

    const response = await GET(request())

    expect(response.status).toBe(500)
  })
})
