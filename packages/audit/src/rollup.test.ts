import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { databaseMock, drizzleOrmMock } from '@sim/testing/mocks/database.mock'
import { idMock } from '@sim/testing/mocks/id.mock'
import { loggerMock } from '@sim/testing/mocks/logger.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => loggerMock)
vi.mock('@sim/utils/id', () => idMock)

import { type AuditRollupEntry, recordAuditRollup, withAuditRollupScope } from './rollup'

function entry(rowId: string): AuditRollupEntry {
  return {
    key: 'rows',
    params: {
      workspaceId: 'workspace-1',
      actorId: null,
      actorName: 'Workflow execution',
      actorEmail: null,
      action: 'table.updated',
      resourceType: 'table',
      resourceId: 'table-1',
      metadata: { rowId, rowsUpdated: 1 },
    },
    rollupMetadata: {},
    counters: { rowsUpdated: 1 },
    identifiers: { rowId },
    describe: ({ entries }) => `changed rows ${entries} times`,
  }
}

function insertedRows(): Array<{ metadata: Record<string, unknown> }> {
  return dbChainMockFns.values.mock.calls.map(([row]) => row)
}

async function settle() {
  await flushMicrotasks(20)
}

describe('audit rollup windows', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('merges a run’s repeats that fall further apart than the unscoped window', async () => {
    let writtenMidRun = -1
    await withAuditRollupScope(async () => {
      for (const rowId of ['row-1', 'row-2', 'row-3']) {
        recordAuditRollup(entry(rowId))
        await vi.advanceTimersByTimeAsync(5_000)
      }
      await settle()
      writtenMidRun = insertedRows().length
    })

    expect(writtenMidRun).toBe(0)
    const rows = insertedRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].metadata).toMatchObject({
      rowIds: ['row-1', 'row-2', 'row-3'],
      rowsUpdated: 3,
      rollup: { entries: 3 },
    })
  })

  it('still writes a long run’s pending row once the scoped window closes', async () => {
    let writtenMidRun = -1
    await withAuditRollupScope(async () => {
      recordAuditRollup(entry('row-1'))
      await vi.advanceTimersByTimeAsync(60_000)
      await settle()
      writtenMidRun = insertedRows().length
      recordAuditRollup(entry('row-2'))
    })

    expect(writtenMidRun).toBe(1)
    expect(insertedRows()).toHaveLength(2)
  })

  it('keeps the short window for rollups recorded outside any run', async () => {
    recordAuditRollup(entry('row-1'))
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()
    recordAuditRollup(entry('row-2'))
    await vi.advanceTimersByTimeAsync(2_000)
    await settle()

    expect(insertedRows()).toHaveLength(2)
    expect(insertedRows()[0].metadata).not.toHaveProperty('rollup')
  })
})
