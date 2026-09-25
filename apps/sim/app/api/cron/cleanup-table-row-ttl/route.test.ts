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
})
