import { createMockRequest } from '@sim/testing'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    mockVerifyCronAuth.mockReturnValue(null)
    mockEnqueue.mockReset()
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
})
