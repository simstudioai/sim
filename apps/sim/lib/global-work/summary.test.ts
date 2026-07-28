/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')

const execute = dbChainMockFns.execute

const dialect = new PgDialect()

function getCapturedQuery(): SQL {
  const query = execute.mock.calls.at(-1)?.[0] as SQL | undefined
  if (!query) throw new Error('Expected a captured Global Work query')
  return query
}

function getCapturedQueryText(): string {
  return dialect.sqlToQuery(getCapturedQuery()).sql
}

import {
  buildZeroFilledGlobalWorkDailySeries,
  GLOBAL_WORK_FORMULA,
  getGlobalWorkMonthWindow,
  getGlobalWorkSummary,
  getLatestCompletedGlobalWorkMonth,
} from '@/lib/global-work/summary'

afterAll(resetDbChainMock)

describe('Global Work Pacific reporting windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('defaults to the latest completed Pacific month across a year boundary', () => {
    expect(getLatestCompletedGlobalWorkMonth(new Date('2026-01-15T12:00:00.000Z'))).toBe('2025-12')
  })

  it('uses the spring DST offset in March', () => {
    const window = getGlobalWorkMonthWindow('2026-03')
    expect(window.periodStart.toISOString()).toBe('2026-03-01T08:00:00.000Z')
    expect(window.periodEnd.toISOString()).toBe('2026-04-01T07:00:00.000Z')
  })

  it('uses the fall DST offset in November', () => {
    const window = getGlobalWorkMonthWindow('2026-11')
    expect(window.periodStart.toISOString()).toBe('2026-11-01T07:00:00.000Z')
    expect(window.periodEnd.toISOString()).toBe('2026-12-01T08:00:00.000Z')
  })

  it('zero-fills every elapsed Pacific day in a current-month series', () => {
    const rows = buildZeroFilledGlobalWorkDailySeries({
      month: '2026-07',
      isCurrentMonth: true,
      now: new Date('2026-07-09T19:00:00.000Z'),
      unitsByDate: new Map([
        ['2026-07-02', { workflow: 2, mothership: 3 }],
        ['2026-07-09', { workflow: 1, mothership: 0 }],
      ]),
    })

    expect(rows).toHaveLength(9)
    expect(rows[0]).toEqual({
      date: '2026-07-01',
      units: 0,
      workflow: 0,
      mothership: 0,
    })
    expect(rows[1]).toEqual({
      date: '2026-07-02',
      units: 5,
      workflow: 2,
      mothership: 3,
    })
    expect(rows[8].date).toBe('2026-07-09')
  })

  it('keeps the reporting formula out of persisted source data', () => {
    expect(GLOBAL_WORK_FORMULA).toEqual({
      minutesPerUnit: 5,
      globalAnnualHours: 2_510_000_000_000,
    })
  })

  it('derives totals and source breakdown from aggregated source rows', async () => {
    execute.mockResolvedValueOnce([
      { source: 'workflow', date: '2026-06-10', units: '7' },
      { source: 'mothership', date: '2026-06-10', units: '5' },
    ])

    const summary = await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    expect(summary.attribution).toBe('estimated')
    expect(summary.scope).toEqual({ type: 'global', id: null })
    expect(summary.formula).toEqual(GLOBAL_WORK_FORMULA)
    expect(summary.units).toBe(12)
    expect(summary.humanEquivalentHours).toBe(1)
    expect(summary.sources).toEqual([
      { source: 'workflow', units: 7, humanEquivalentHours: 0.58 },
      { source: 'mothership', units: 5, humanEquivalentHours: 0.42 },
    ])
    expect(summary.daily[9]).toEqual({
      date: '2026-06-10',
      units: 12,
      workflow: 7,
      mothership: 5,
    })
  })

  it('encodes month boundaries before passing raw SQL parameters to postgres.js', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const { params } = dialect.sqlToQuery(getCapturedQuery())
    expect(params.slice(0, 4)).toEqual([
      '2026-06-01T07:00:00.000Z',
      '2026-07-01T07:00:00.000Z',
      '2026-06-01T07:00:00.000Z',
      '2026-07-01T07:00:00.000Z',
    ])
    expect(params.slice(0, 4).every((parameter) => !(parameter instanceof Date))).toBe(true)
  })

  it('does not reinterpret an explicit free billing snapshot after a later upgrade', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const queryText = getCapturedQueryText()
    expect(queryText).toContain("wel.execution_data ? 'billingAttribution' AS has_billing_snapshot")
    expect(queryText).toContain('su.has_billing_snapshot')
    expect(queryText).toContain('NOT su.has_billing_snapshot')
    expect(queryText).not.toContain('su.snapshot_plan IS NULL\n            AND EXISTS')
  })

  it('does not treat a non-entitled subscription period as proof of payment', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const queryText = getCapturedQueryText()
    expect(queryText).toContain("s.status IN ('active', 'past_due')")
    expect(queryText).toContain("s.status = 'canceled'")
    expect(queryText).toContain('COALESCE(s.ended_at, s.canceled_at) >= su.occurred_at')
    expect(queryText).not.toContain('COALESCE(s.ended_at, s.period_end')
  })

  it('matches canonical paid plan names and excludes known free-trial work', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const queryText = getCapturedQueryText()
    expect(queryText).toContain("su.snapshot_plan IN ('enterprise', 'pro', 'team')")
    expect(queryText).toContain("left(su.snapshot_plan, 4) = 'pro_'")
    expect(queryText).toContain("left(su.snapshot_plan, 5) = 'team_'")
    expect(queryText).toContain("s.plan IN ('enterprise', 'pro', 'team')")
    expect(queryText).toContain("left(s.plan, 4) = 'pro_'")
    expect(queryText).toContain("left(s.plan, 5) = 'team_'")
    expect(queryText).toContain('s.trial_end IS NULL OR su.occurred_at >= s.trial_end')
    expect(queryText).not.toContain("snapshot_plan LIKE 'pro%'")
    expect(queryText).not.toContain("s.plan LIKE 'pro%'")
  })

  it('only probes usage_log when a workflow lacks an immutable billing snapshot', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const queryText = getCapturedQueryText()
    expect(queryText).toContain("WHERE NOT (wel.execution_data ? 'billingAttribution')")
  })

  it('counts canonical units, collapses only fork-copied messages, and excludes exact internal domains', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const queryText = getCapturedQueryText()
    expect(queryText).toContain("wel.status = 'completed'")
    expect(queryText).toContain("wel.level = 'info'")
    expect(queryText).toContain("cc.type = 'mothership'")
    expect(queryText).toContain("cm.role = 'user'")
    expect(queryText).toContain('PARTITION BY cc.user_id, cm.message_id, cm.created_at')
    expect(queryText).toContain("NOT IN ('sim.ai', 'simstudio.ai')")
    expect(queryText).toContain("AT TIME ZONE 'UTC'")
    expect(dialect.sqlToQuery(getCapturedQuery()).params).toContain('America/Los_Angeles')
  })

  it('filters a user by recorded actor without changing payer eligibility', async () => {
    execute.mockResolvedValueOnce([])

    const summary = await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'), {
      type: 'user',
      id: 'user-1',
    })

    const query = dialect.sqlToQuery(getCapturedQuery())
    expect(query.sql).toContain('su.actor_user_id = $')
    expect(query.params.filter((parameter) => parameter === 'user-1')).toHaveLength(2)
    expect(summary.scope).toEqual({ type: 'user', id: 'user-1' })
  })

  it('filters an organization by both billing entity type and ID', async () => {
    execute.mockResolvedValueOnce([])

    const summary = await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'), {
      type: 'organization',
      id: 'org-1',
    })

    const query = dialect.sqlToQuery(getCapturedQuery())
    expect(query.sql).toContain("su.billing_entity_type = 'organization'")
    expect(query.sql).toContain('su.billing_entity_id = $')
    expect(query.params.filter((parameter) => parameter === 'org-1')).toHaveLength(2)
    expect(summary.scope).toEqual({ type: 'organization', id: 'org-1' })
  })

  it('preserves billing entity type across snapshots, usage fallback, and current workspace state', async () => {
    execute.mockResolvedValueOnce([])

    await getGlobalWorkSummary('2026-06', new Date('2026-07-09T12:00:00.000Z'))

    const queryText = getCapturedQueryText()
    expect(queryText).toContain("'{billingAttribution,billingEntity,type}'")
    expect(queryText).toContain('usage_scope.billing_entity_type::text')
    expect(queryText).toContain('wb.billing_entity_type')
  })
})
