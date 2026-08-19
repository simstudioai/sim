/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordSecretUsage } from '@/lib/secrets/usage/record'

/** `recordSecretUsage` is fire-and-forget, so tests await the microtask it queues. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('recordSecretUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('writes one statement for every secret a run resolved', async () => {
    recordSecretUsage(
      [
        { name: 'API_KEY', scope: 'workspace', ownerUserId: null },
        { name: 'MY_TOKEN', scope: 'personal', ownerUserId: 'owner-1' },
      ],
      {
        workspaceId: 'workspace-1',
        source: 'workflow',
        actorUserId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        trigger: 'schedule',
      }
    )
    await flush()

    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
    const rows = dbChainMockFns.values.mock.calls[0]?.[0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      workspaceId: 'workspace-1',
      secretName: 'API_KEY',
      secretScope: 'workspace',
      source: 'workflow',
      workflowId: 'workflow-1',
      actorUserId: 'user-1',
      secretOwnerUserId: '',
      useCount: 1,
      lastExecutionId: 'execution-1',
      lastTrigger: 'schedule',
    })
    /**
     * The owner is stored, not the actor: a scheduled run resolves the workflow owner's
     * personal slice under the workspace's execution actor, and filing the row under the
     * actor would hide it from the person whose secret it actually is.
     */
    expect(rows[1]).toMatchObject({
      secretName: 'MY_TOKEN',
      secretScope: 'personal',
      secretOwnerUserId: 'owner-1',
      actorUserId: 'user-1',
    })
  })

  it('buckets by UTC day rather than the server calendar', async () => {
    vi.useFakeTimers()
    try {
      /** 00:30 UTC — a server behind UTC would bucket this as the previous day. */
      vi.setSystemTime(new Date('2026-03-14T00:30:00.000Z'))
      recordSecretUsage([{ name: 'API_KEY', scope: 'workspace', ownerUserId: null }], {
        workspaceId: 'workspace-1',
        source: 'workflow',
        actorUserId: 'user-1',
      })
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
    await flush()

    expect(dbChainMockFns.values.mock.calls[0]?.[0][0]).toMatchObject({ usageDate: '2026-03-14' })
  })

  it('increments the existing bucket instead of inserting a duplicate', async () => {
    recordSecretUsage([{ name: 'API_KEY', scope: 'workspace', ownerUserId: null }], {
      workspaceId: 'workspace-1',
      source: 'workflow',
      actorUserId: 'user-1',
    })
    await flush()

    const conflict = dbChainMockFns.onConflictDoUpdate.mock.calls[0]?.[0]
    /** Every column of the day bucket, or two runs would collide into one row. */
    expect(conflict?.target).toHaveLength(8)
    const set = JSON.stringify(conflict?.set)
    expect(set).toContain(' + 1')
    /** Out-of-order completions must not walk the most recent timestamp backwards. */
    expect(set).toContain('greatest(')
  })

  it('writes a Copilot run without a workflow', async () => {
    recordSecretUsage([{ name: 'API_KEY', scope: 'workspace', ownerUserId: null }], {
      workspaceId: 'workspace-1',
      source: 'copilot',
      actorUserId: 'user-1',
      trigger: 'copilot',
    })
    await flush()

    /** Empty rather than null: the unique bucket key has to stay null-free on Postgres 14. */
    expect(dbChainMockFns.values.mock.calls[0]?.[0][0]).toMatchObject({
      source: 'copilot',
      workflowId: '',
    })
  })

  it('does not touch the database when a run resolved nothing', async () => {
    recordSecretUsage([], {
      workspaceId: 'workspace-1',
      source: 'workflow',
      actorUserId: 'user-1',
    })
    await flush()

    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('never rejects when the write fails', async () => {
    dbChainMockFns.onConflictDoUpdate.mockRejectedValueOnce(new Error('constraint violation'))

    expect(() =>
      recordSecretUsage([{ name: 'API_KEY', scope: 'workspace', ownerUserId: null }], {
        workspaceId: 'workspace-1',
        source: 'workflow',
        actorUserId: 'user-1',
      })
    ).not.toThrow()
    await flush()
  })
})
