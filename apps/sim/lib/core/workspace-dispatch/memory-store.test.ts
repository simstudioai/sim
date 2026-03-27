/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryWorkspaceDispatchStorage } from '@/lib/core/workspace-dispatch/memory-store'

describe('memory workspace dispatch storage', () => {
  const store = new MemoryWorkspaceDispatchStorage()

  afterEach(async () => {
    await store.clear()
  })

  it('claims a runnable job and marks it admitting with a lease', async () => {
    const record = await store.enqueueWorkspaceDispatchJob({
      workspaceId: 'workspace-1',
      lane: 'runtime',
      queueName: 'workflow-execution',
      bullmqJobName: 'workflow-execution',
      bullmqPayload: { payload: { workflowId: 'workflow-1' } },
      metadata: {
        workflowId: 'workflow-1',
      },
    })

    const result = await store.claimWorkspaceJob('workspace-1', {
      lanes: ['runtime'],
      concurrencyLimit: 1,
      leaseId: 'lease-1',
      now: Date.now(),
      leaseTtlMs: 1000,
    })

    expect(result.type).toBe('admitted')
    if (result.type === 'admitted') {
      expect(result.record.id).toBe(record.id)
      expect(result.record.status).toBe('admitting')
      expect(result.record.lease?.leaseId).toBe('lease-1')
    }
  })

  it('returns delayed when only delayed jobs exist', async () => {
    await store.enqueueWorkspaceDispatchJob({
      workspaceId: 'workspace-1',
      lane: 'runtime',
      queueName: 'workflow-execution',
      bullmqJobName: 'workflow-execution',
      bullmqPayload: { payload: { workflowId: 'workflow-1' } },
      metadata: {
        workflowId: 'workflow-1',
      },
      delayMs: 5000,
    })

    const result = await store.claimWorkspaceJob('workspace-1', {
      lanes: ['runtime'],
      concurrencyLimit: 1,
      leaseId: 'lease-2',
      now: Date.now(),
      leaseTtlMs: 1000,
    })

    expect(result.type).toBe('delayed')
  })
})
