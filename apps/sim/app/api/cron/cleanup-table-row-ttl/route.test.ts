/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue, mockGetJobQueue, mockIsTableRowTtlEnabled, mockVerifyCronAuth } = vi.hoisted(
  () => ({
    mockEnqueue: vi.fn(),
    mockGetJobQueue: vi.fn(),
    mockIsTableRowTtlEnabled: vi.fn(),
    mockVerifyCronAuth: vi.fn(),
  })
)

vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: mockVerifyCronAuth }))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: mockGetJobQueue }))
vi.mock('@/lib/table/ttl-availability', () => ({
  isTableRowTtlEnabled: mockIsTableRowTtlEnabled,
}))

import { GET } from '@/app/api/cron/cleanup-table-row-ttl/route'

describe('table row TTL cleanup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T17:01:00Z'))
    mockVerifyCronAuth.mockReturnValue(null)
    mockIsTableRowTtlEnabled.mockResolvedValue(true)
    mockEnqueue.mockResolvedValue('job-ttl-1')
    mockGetJobQueue.mockResolvedValue({ enqueue: mockEnqueue })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues one serialized cleanup job', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ triggered: true, jobId: 'job-ttl-1' })
    expect(mockEnqueue).toHaveBeenCalledWith(
      'cleanup-table-row-ttl',
      {},
      expect.objectContaining({
        maxAttempts: 1,
        jobId: 'cleanup-table-row-ttl:1986020',
        concurrencyKey: 'cleanup:table-row-ttl',
        concurrencyLimit: 1,
        runner: expect.any(Function),
      })
    )
  })

  it('deduplicates retries within the same fifteen-minute schedule window', async () => {
    const request = () =>
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )

    await GET(request())
    vi.advanceTimersByTime(13 * 60 * 1000)
    await GET(request())

    expect(mockEnqueue.mock.calls[0]?.[2]?.jobId).toBe(mockEnqueue.mock.calls[1]?.[2]?.jobId)
  })

  it('uses a new id immediately after the next fifteen-minute window begins', async () => {
    const request = () =>
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )

    vi.setSystemTime(new Date('2026-08-22T17:14:59.999Z'))
    await GET(request())
    vi.setSystemTime(new Date('2026-08-22T17:15:00.000Z'))
    await GET(request())

    expect(mockEnqueue.mock.calls[0]?.[2]?.jobId).not.toBe(mockEnqueue.mock.calls[1]?.[2]?.jobId)
  })

  it('returns the cron auth refusal without touching the queue', async () => {
    mockVerifyCronAuth.mockReturnValue(new Response(null, { status: 401 }))

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )
    )

    expect(response.status).toBe(401)
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })

  it('does not enqueue cleanup while the feature is disabled', async () => {
    mockIsTableRowTtlEnabled.mockResolvedValue(false)

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/cron/cleanup-table-row-ttl'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      triggered: false,
      reason: 'feature-disabled',
    })
    expect(mockGetJobQueue).not.toHaveBeenCalled()
  })
})
