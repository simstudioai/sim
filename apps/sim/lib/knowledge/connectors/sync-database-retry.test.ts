import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }))
vi.mock('@sim/logger', async () => {
  const { createMockLogger } = await import('@sim/testing/mocks/logger.mock')
  return { createLogger: () => ({ ...createMockLogger(), error: mockLogError }) }
})

import {
  countZeroProgressFailedRuns,
  DATABASE_FAILURE_ALERT_STREAK,
  DATABASE_RETRY_AFTER_PROGRESS_MS,
  databaseRetryDelayMs,
  resolveDatabaseRetryDelayMs,
} from '@/lib/knowledge/connectors/sync-database-retry'
import {
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'

const MINUTE = 60 * 1000
const NO_WRITES = { docsAdded: 0, docsUpdated: 0, docsDeleted: 0 }
/** A failed row carries the database failure class that ended it unless a test says otherwise. */
const failureClassOf = (status: string) => (status === 'failed' ? 'capacity' : null)
const contentRun = (
  status: string,
  writes: Partial<typeof NO_WRITES> = {},
  databaseFailureClass: string | null = failureClassOf(status)
) => ({
  status,
  databaseFailureClass,
  ...NO_WRITES,
  ...writes,
})
const _memberRun = (
  status: string,
  writes: Record<string, number> = {},
  databaseFailureClass: string | null = failureClassOf(status)
) => ({
  status,
  databaseFailureClass,
  membersCompleted: 0,
  docsAdded: 0,
  docsUpdated: 0,
  docsPurged: 0,
  ...writes,
})

describe('countZeroProgressFailedRuns', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('counts this run plus the failed runs before it, up to the last one that did not fail', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
      contentRun('failed'),
      contentRun('failed'),
      contentRun('completed'),
      contentRun('failed'),
    ])
    expect(await countZeroProgressFailedRuns('content', 'c-1', 'run-1')).toBe(3)
  })

  it.each([
    ['added', { docsAdded: 5 }],
    ['updated', { docsUpdated: 1 }],
    ['deleted', { docsDeleted: 2 }],
  ])('ends the streak at a failed run that %s documents', async (_label, writes) => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
      contentRun('failed'),
      contentRun('failed', writes),
      contentRun('failed'),
    ])
    expect(await countZeroProgressFailedRuns('content', 'c-1', 'run-1')).toBe(2)
  })

  it('excludes the current run and reads only as far back as the ladder climbs', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [])
    await countZeroProgressFailedRuns('content', 'c-1', 'run-1')
    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        where,
        (node) =>
          node.type === 'ne' &&
          node.left === schemaMock.knowledgeConnectorSyncLog.id &&
          node.right === 'run-1'
      )
    ).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(
      CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES / 30 - 1
    )
  })

  it('falls back to this run alone when the history read times out', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
      contentRun('failed'),
      contentRun('failed'),
    ])
    dbChainMockFns.limit.mockRejectedValueOnce(
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    )
    expect(await countZeroProgressFailedRuns('content', 'c-1', 'run-1')).toBe(1)
  })
})

describe('databaseRetryDelayMs', () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 90],
    [10, 300],
  ])('climbs the failure ladder with the streak (%i failed runs → %i min)', (streak, minutes) => {
    const delay = databaseRetryDelayMs(streak, 0)
    expect(delay).toBeGreaterThanOrEqual(minutes * MINUTE)
    expect(delay).toBeLessThanOrEqual(minutes * MINUTE + MINUTE)
  })

  it('never waits less than the rung the breaker count already earned', () => {
    const delay = databaseRetryDelayMs(1, MAX_CONSECUTIVE_FAILURES - 1)
    expect(delay).toBeGreaterThanOrEqual(MAX_CONSECUTIVE_FAILURES * 30 * MINUTE)
  })
})

describe('resolveDatabaseRetryDelayMs', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  const retry = {
    kind: 'content' as const,
    connectorId: 'c-1',
    runId: 'run-1',
    previousFailures: 0,
  }

  it('retries shortly after a run that made progress, without reading the streak', async () => {
    queueTableRows(
      schemaMock.knowledgeConnectorSyncLog,
      Array.from({ length: 20 }, () => contentRun('failed'))
    )
    const delay = await resolveDatabaseRetryDelayMs({ ...retry, madeProgress: true })
    expect(delay).toBeGreaterThanOrEqual(DATABASE_RETRY_AFTER_PROGRESS_MS)
    expect(delay).toBeLessThanOrEqual(DATABASE_RETRY_AFTER_PROGRESS_MS + MINUTE)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('climbs the ladder by the zero-progress streak for a run that made none', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
      contentRun('failed'),
      contentRun('failed'),
      contentRun('completed'),
    ])
    const delay = await resolveDatabaseRetryDelayMs({ ...retry, madeProgress: false })
    expect(delay).toBeGreaterThanOrEqual(90 * MINUTE)
    expect(delay).toBeLessThanOrEqual(91 * MINUTE)
  })

  /** Throttled or provider-failed runs are logged `failed` too, but say nothing of the database. */
  it('neither climbs nor alerts on failed runs the database did not cause', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
      contentRun('failed'),
      ...Array.from({ length: DATABASE_FAILURE_ALERT_STREAK }, () =>
        contentRun('failed', {}, null)
      ),
    ])
    const delay = await resolveDatabaseRetryDelayMs({ ...retry, madeProgress: false })
    expect(delay).toBeLessThanOrEqual(61 * MINUTE)
    expect(mockLogError).not.toHaveBeenCalled()
  })
})
