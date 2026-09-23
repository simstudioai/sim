/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  countFailedRunStreak,
  databaseRetryDelayMs,
} from '@/lib/knowledge/connectors/sync-database-retry'
import {
  CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'

const MINUTE = 60 * 1000
const runs = (...statuses: string[]) => statuses.map((status) => ({ status }))

describe('countFailedRunStreak', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('counts this run plus the failed runs before it, up to the last one that did not fail', async () => {
    queueTableRows(
      schemaMock.knowledgeConnectorSyncLog,
      runs('failed', 'failed', 'completed', 'failed')
    )
    expect(await countFailedRunStreak('content', 'c-1', 'run-1')).toBe(3)
  })

  it('counts only this run after a success', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, runs('completed', 'failed'))
    expect(await countFailedRunStreak('content', 'c-1', 'run-1')).toBe(1)
  })

  it('counts an unbroken history in full', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, runs('failed', 'failed'))
    expect(await countFailedRunStreak('content', 'c-1', 'run-1')).toBe(3)
  })

  it('reads the members-mode run log for a members-mode run', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMemberSyncLog, runs('failed', 'started'))
    expect(await countFailedRunStreak('member', 'c-1', 'run-1')).toBe(2)
  })

  it('excludes the current run and reads only as far back as the ladder climbs', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [])
    await countFailedRunStreak('content', 'c-1', 'run-1')
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

  it('falls back to this run alone when the history cannot be read', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('canceling statement'))
    expect(await countFailedRunStreak('content', 'c-1', 'run-1')).toBe(1)
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

  it('stops at the ladder ceiling', () => {
    expect(databaseRetryDelayMs(1_000, 0)).toBeLessThanOrEqual(
      CONNECTOR_FAILURE_BACKOFF_CAP_MINUTES * MINUTE + MINUTE
    )
  })

  it('never waits less than the rung the breaker count already earned', () => {
    const delay = databaseRetryDelayMs(1, MAX_CONSECUTIVE_FAILURES - 1)
    expect(delay).toBeGreaterThanOrEqual(MAX_CONSECUTIVE_FAILURES * 30 * MINUTE)
  })
})
