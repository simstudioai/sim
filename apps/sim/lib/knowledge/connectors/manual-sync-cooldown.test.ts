/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertManualSyncCooldown } from '@/lib/knowledge/connectors/manual-sync-cooldown'

const NOW = new Date('2026-09-01T12:00:00Z')
const CONNECTOR = {
  status: 'active',
  memberSyncStatus: 'idle',
  lastSyncError: null,
  lastMemberSyncError: null,
}

describe.each(['content', 'member'] as const)('manual %s sync cooldown', (kind) => {
  const log =
    kind === 'content'
      ? schemaMock.knowledgeConnectorSyncLog
      : schemaMock.knowledgeConnectorMemberSyncLog
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    resetDbChainMock()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetDbChainMock()
  })

  it('locks the connector before reading its latest successful completion', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(log, [
      { status: 'completed', completedAt: new Date(NOW.getTime() - 10_000), failures: 0 },
    ])
    await expect(assertManualSyncCooldown(db, 'connector-1', kind)).rejects.toMatchObject({
      code: 'conflict',
      message: 'Sync finished recently. Try again in 50 seconds.',
    })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.from.mock.invocationCallOrder[1]
    )
    expect(dbChainMockFns.orderBy).toHaveBeenCalledOnce()
    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(2, 1)
  })

  it.each([60_000, 60_001])('allows a completed run after %i milliseconds', async (age) => {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(log, [
      { status: 'completed', completedAt: new Date(NOW.getTime() - age), failures: 0 },
    ])
    await expect(assertManualSyncCooldown(db, 'connector-1', kind)).resolves.toBeUndefined()
  })

  it.each(['failed', 'partial', 'started'])(
    'allows recovery when the latest run is %s',
    async (status) => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
      queueTableRows(log, [{ status, completedAt: NOW, failures: 0 }])
      await expect(assertManualSyncCooldown(db, 'connector-1', kind)).resolves.toBeUndefined()
    }
  )

  it.each([null, new Date('invalid')])(
    'does not invent a cooldown without a valid completion time',
    async (completedAt) => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
      queueTableRows(log, [{ status: 'completed', completedAt, failures: 0 }])
      await expect(assertManualSyncCooldown(db, 'connector-1', kind)).resolves.toBeUndefined()
    }
  )

  it('allows the first sync and legacy completed runs with failures', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(log, [])
    await expect(assertManualSyncCooldown(db, 'connector-1', kind)).resolves.toBeUndefined()
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(log, [{ status: 'completed', completedAt: NOW, failures: 1 }])
    await expect(assertManualSyncCooldown(db, 'connector-1', kind)).resolves.toBeUndefined()
  })

  it('permits retry after failed queue handoff without requiring a new run log', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        ...CONNECTOR,
        ...(kind === 'content'
          ? { status: 'error', lastSyncError: 'Sync could not be queued' }
          : { memberSyncStatus: 'error', lastMemberSyncError: 'Sync could not be queued' }),
      },
    ])
    await expect(assertManualSyncCooldown(db, 'connector-1', kind)).resolves.toBeUndefined()
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(log)
  })
})
