/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceConcurrencyLimit, mockAcquireLock, mockReleaseLock } = vi.hoisted(() => ({
  mockGetWorkspaceConcurrencyLimit: vi.fn(),
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
}))

vi.mock('@/lib/billing/workspace-concurrency', () => ({
  getWorkspaceConcurrencyLimit: mockGetWorkspaceConcurrencyLimit,
}))

vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
  getRedisClient: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/core/bullmq', () => ({
  getBullMQQueueByName: vi.fn().mockReturnValue({
    add: vi.fn().mockResolvedValue({ id: 'bullmq-1' }),
  }),
}))

import { MemoryWorkspaceDispatchStorage } from '@/lib/core/workspace-dispatch/memory-store'
import {
  DISPATCH_SCAN_RESULTS,
  dispatchNextAdmissibleWorkspaceJob,
} from '@/lib/core/workspace-dispatch/planner'
import {
  enqueueWorkspaceDispatchJob,
  setWorkspaceDispatchStorageAdapter,
} from '@/lib/core/workspace-dispatch/store'

describe('workspace dispatch integration (memory-backed)', () => {
  let store: MemoryWorkspaceDispatchStorage

  beforeEach(async () => {
    vi.clearAllMocks()
    store = new MemoryWorkspaceDispatchStorage()
    setWorkspaceDispatchStorageAdapter(store)

    mockGetWorkspaceConcurrencyLimit.mockResolvedValue(5)
    mockAcquireLock.mockResolvedValue(true)
    mockReleaseLock.mockResolvedValue(true)
  })

  async function enqueue(
    workspaceId: string,
    overrides: { lane?: string; delayMs?: number; priority?: number } = {}
  ) {
    return enqueueWorkspaceDispatchJob({
      workspaceId,
      lane: (overrides.lane ?? 'runtime') as 'runtime',
      queueName: 'workflow-execution',
      bullmqJobName: 'workflow-execution',
      bullmqPayload: { payload: { workflowId: 'wf-1' } },
      metadata: { workflowId: 'wf-1' },
      delayMs: overrides.delayMs,
      priority: overrides.priority,
    })
  }

  it('admits jobs round-robin across workspaces', async () => {
    await enqueue('ws-a')
    await enqueue('ws-b')
    await enqueue('ws-a')

    const r1 = await dispatchNextAdmissibleWorkspaceJob()
    const r2 = await dispatchNextAdmissibleWorkspaceJob()
    const r3 = await dispatchNextAdmissibleWorkspaceJob()

    expect(r1).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)
    expect(r2).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)
    expect(r3).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)
  })

  it('respects workspace concurrency limits', async () => {
    mockGetWorkspaceConcurrencyLimit.mockResolvedValue(1)

    await enqueue('ws-a')
    await enqueue('ws-a')

    const r1 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r1).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)

    const r2 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r2).toBe(DISPATCH_SCAN_RESULTS.NO_PROGRESS)
  })

  it('skips delayed jobs and admits ready ones in same lane', async () => {
    await enqueue('ws-a', { delayMs: 60_000 })
    await enqueue('ws-a', { delayMs: 0 })

    const r1 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r1).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)
  })

  it('returns delayed when all jobs are delayed', async () => {
    await enqueue('ws-a', { delayMs: 60_000 })

    const r1 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r1).toBe(DISPATCH_SCAN_RESULTS.NO_PROGRESS)
  })

  it('returns no_workspace when queue is empty', async () => {
    const result = await dispatchNextAdmissibleWorkspaceJob()
    expect(result).toBe(DISPATCH_SCAN_RESULTS.NO_WORKSPACE)
  })

  it('lease cleanup frees capacity for new admissions', async () => {
    mockGetWorkspaceConcurrencyLimit.mockResolvedValue(1)

    const record = await enqueue('ws-a')
    await enqueue('ws-a')

    const r1 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r1).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)

    const updated = await store.getDispatchJobRecord(record.id)
    if (updated?.lease) {
      await store.releaseWorkspaceLease('ws-a', updated.lease.leaseId)
    }

    const r2 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r2).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)
  })

  it('expired leases are cleaned up during claim', async () => {
    mockGetWorkspaceConcurrencyLimit.mockResolvedValue(1)

    await enqueue('ws-a')
    await enqueue('ws-a')

    const claimResult = await store.claimWorkspaceJob('ws-a', {
      lanes: ['runtime'],
      concurrencyLimit: 1,
      leaseId: 'old-lease',
      now: Date.now(),
      leaseTtlMs: 1,
    })
    expect(claimResult.type).toBe('admitted')

    await new Promise((resolve) => setTimeout(resolve, 10))

    const r2 = await dispatchNextAdmissibleWorkspaceJob()
    expect(r2).toBe(DISPATCH_SCAN_RESULTS.ADMITTED)
  })

  it('recovers job to waiting via restoreWorkspaceDispatchJob', async () => {
    const record = await enqueue('ws-a')

    await store.claimWorkspaceJob('ws-a', {
      lanes: ['runtime'],
      concurrencyLimit: 1,
      leaseId: 'lease-1',
      now: Date.now(),
      leaseTtlMs: 1000,
    })

    await store.markDispatchJobAdmitted(record.id, 'ws-a', 'lease-1', Date.now() + 10000)

    const admitted = await store.getDispatchJobRecord(record.id)
    expect(admitted).toBeDefined()
    const resetRecord = { ...admitted!, status: 'waiting' as const, lease: undefined }
    await store.restoreWorkspaceDispatchJob(resetRecord)

    const restored = await store.getDispatchJobRecord(record.id)
    expect(restored?.status).toBe('waiting')
    expect(restored?.lease).toBeUndefined()
  })
})
