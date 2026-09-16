/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseJobQueue } from '@/lib/core/async-jobs/backends/database'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@sim/db', () => ({ db: dbChainMock.db, asyncJobs: schemaMock.asyncJobs }))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: async () => new DatabaseJobQueue() }))
vi.mock('@/lib/knowledge/connectors/external-group-sync', () => ({
  refreshConnectorDirectory: refresh,
}))

import { dispatchDirectorySync } from '@/lib/knowledge/connectors/directory-queue'

describe('local directory sync dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'job' }])
  })

  it('runs only two refreshes at once across overlapping dispatch calls', async () => {
    const releases: Array<() => void> = []
    let active = 0
    let maximum = 0
    refresh.mockImplementation(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return 'refreshed'
    })
    const options = { requestId: 'request-1', tickAt: new Date() }
    await Promise.all(['one', 'two', 'three'].map((id) => dispatchDirectorySync(id, options)))
    try {
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2), { interval: 1 })
      expect(active).toBe(2)
      releases.shift()?.()
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(3), { interval: 1 })
      expect(maximum).toBe(2)
    } finally {
      for (const release of releases) release()
      await vi.waitFor(() => expect(active).toBe(0), { interval: 1 })
    }
  })
})
