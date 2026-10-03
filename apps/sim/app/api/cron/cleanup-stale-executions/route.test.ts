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

/** The job id a dispatch was keyed to, as the queue reports it back. */
async function dispatchedJobId(): Promise<string> {
  const response = await GET(request())
  expect(response.status).toBe(200)
  const body = (await response.json()) as { jobId: string }
  return body.jobId
}

describe('stale execution cleanup route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T17:31:00Z'))
    mockVerifyCronAuth.mockReturnValue(null)
    mockEnqueue.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers with the dispatched job once the cleanup is enqueued', async () => {
    mockEnqueue.mockResolvedValueOnce('job-stale-1')

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ triggered: true, jobId: 'job-stale-1' })
  })

  it('fails the cron invocation when the job cannot be enqueued', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))

    const response = await GET(request())

    expect(response.status).toBe(500)
  })

  describe('with a queue that keys each job by the id it is given', () => {
    beforeEach(() => {
      mockEnqueue.mockImplementation(
        async (_type: string, _payload: unknown, options: { jobId: string }) => options.jobId
      )
    })

    it('dispatches a retry inside the same thirty-minute window as the same job', async () => {
      const first = await dispatchedJobId()
      vi.setSystemTime(new Date('2026-10-01T17:59:59.999Z'))

      expect(await dispatchedJobId()).toBe(first)
    })

    it('dispatches a new job once the next thirty-minute window begins', async () => {
      const first = await dispatchedJobId()
      vi.setSystemTime(new Date('2026-10-01T18:00:00.000Z'))

      expect(await dispatchedJobId()).not.toBe(first)
    })
  })
})
