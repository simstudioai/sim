/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ResolvedUsagePeriod } from '@/lib/billing/core/reporting-period'
import {
  buildUsageAnalyticsScope,
  densifyUsageSeries,
  foldUsageBreakdown,
  MAX_CUSTOM_RANGE_DAYS,
  mergeRowsByKey,
  resolvePreviousPeriod,
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  UsageWindowRangeInvertedError,
  UsageWindowRangeTooLargeError,
  usageWindowLedgerFilter,
} from '@/lib/billing/core/usage-analytics'

const ENTITY = { type: 'organization', id: 'org-1' } as const

function period(overrides: Partial<ResolvedUsagePeriod> = {}): ResolvedUsagePeriod {
  return {
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-09-01T00:00:00.000Z'),
    source: 'stripe',
    anchorDate: null,
    interval: null,
    ...overrides,
  }
}

/** The generated predicate as SQL-ish text, for asserting which columns it filters. */
function scopeShape(window: Parameters<typeof buildUsageAnalyticsScope>[1]): string {
  return JSON.stringify(buildUsageAnalyticsScope(ENTITY, window))
}

describe('buildUsageAnalyticsScope', () => {
  it('matches a reporting period on created_at, not on the stamps', () => {
    // A reporting period is derived from an anchor date and is not what rows carry,
    // so matching the stamps would return nothing for every enterprise org.
    const shape = scopeShape({
      kind: 'period',
      period: period({ source: 'reporting', anchorDate: '2026-08-01', interval: 'month' }),
    })
    expect(shape).toContain('usageLog.createdAt')
    expect(shape).not.toContain('usageLog.billingPeriodStart')
  })

  it('matches a stripe period on the exact stamps', () => {
    const shape = scopeShape({ kind: 'period', period: period({ source: 'stripe' }) })
    expect(shape).toContain('usageLog.billingPeriodStart')
    expect(shape).toContain('usageLog.billingPeriodEnd')
  })

  it('matches a plain range on created_at', () => {
    const shape = scopeShape({
      kind: 'range',
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    })
    expect(shape).toContain('usageLog.createdAt')
    expect(shape).not.toContain('usageLog.billingPeriodStart')
  })

  it('always scopes to the billing entity', () => {
    const shape = scopeShape({ kind: 'period', period: period() })
    expect(shape).toContain('usageLog.billingEntityType')
    expect(shape).toContain('usageLog.billingEntityId')
  })
})

describe('usageWindowLedgerFilter', () => {
  it('matches a stripe period on the stamps, as the aggregate does', () => {
    // Filtering this window on `created_at` instead selects a different set — rows
    // created inside the period but stamped to another, and vice versa — so the event
    // list and the CSV covered different rows than the totals above them.
    const filter = usageWindowLedgerFilter({ kind: 'period', period: period({ source: 'stripe' }) })
    expect(filter).toEqual({
      billingPeriod: {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-09-01T00:00:00.000Z'),
      },
    })
  })

  it('matches a reporting period on created_at, as the aggregate does', () => {
    const filter = usageWindowLedgerFilter({
      kind: 'period',
      period: period({ source: 'reporting', anchorDate: '2026-08-01', interval: 'month' }),
    })
    expect(filter.billingPeriod).toBeUndefined()
    expect(filter.endDateExclusive).toBe(true)
  })

  it('keeps a plain range half-open', () => {
    const from = new Date('2026-08-01T00:00:00.000Z')
    const to = new Date('2026-08-08T00:00:00.000Z')
    expect(usageWindowLedgerFilter({ kind: 'range', from, to })).toEqual({
      startDate: from,
      endDate: to,
      endDateExclusive: true,
    })
  })

  it('branches on the same condition the scope builder does', () => {
    // The two predicates are only in step because they read the same discriminant.
    for (const source of ['reporting', 'stripe', 'default'] as const) {
      const window = { kind: 'period' as const, period: period({ source }) }
      const usesStamps = scopeShape(window).includes('usageLog.billingPeriodStart')
      expect(usageWindowLedgerFilter(window).billingPeriod !== undefined).toBe(usesStamps)
    }
  })
})

describe('resolveUsageAnalyticsWindow', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')

  it('keeps current-period a period so it matches the billing page', () => {
    const window = resolveUsageAnalyticsWindow({ preset: 'current-period', period: period(), now })
    expect(window).toEqual({ kind: 'period', period: period() })
  })

  it('derives the previous reporting period from its anchor', () => {
    const window = resolveUsageAnalyticsWindow({
      preset: 'previous-period',
      period: period({ source: 'reporting', anchorDate: '2026-01-15', interval: 'month' }),
      now,
    })
    expect(window.kind).toBe('period')
  })

  it('falls back to an equal-length range when the previous period is not derivable', () => {
    // A stripe period's predecessor lives in Stripe; inventing stamps would match nothing.
    const window = resolveUsageAnalyticsWindow({
      preset: 'previous-period',
      period: period({ source: 'stripe' }),
      now,
    })
    expect(window.kind).toBe('range')
    if (window.kind === 'range') {
      expect(window.to).toEqual(new Date('2026-08-01T00:00:00.000Z'))
      expect(window.from).toEqual(new Date('2026-07-01T00:00:00.000Z'))
    }
  })

  it('makes a custom range half-open so a single day returns that day', () => {
    const window = resolveUsageAnalyticsWindow({
      preset: 'custom',
      period: period(),
      customStart: new Date('2026-08-04T00:00:00.000Z'),
      customEnd: new Date('2026-08-04T00:00:00.000Z'),
      now,
    })
    expect(window).toEqual({
      kind: 'range',
      from: new Date('2026-08-04T00:00:00.000Z'),
      to: new Date('2026-08-05T00:00:00.000Z'),
    })
  })

  it('covers exactly the days the picker emitted, from its bare date bounds', () => {
    // The picker sends `YYYY-MM-DD`, which parses as UTC midnight. It must not send
    // an inclusive `…T23:59:59` wall time: the extra day added below would then land
    // on the *following* day, and every custom range would overrun by 24 hours.
    const window = resolveUsageAnalyticsWindow({
      preset: 'custom',
      period: period(),
      customStart: new Date('2026-06-01'),
      customEnd: new Date('2026-08-31'),
      now,
    })
    expect(window).toEqual({
      kind: 'range',
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-09-01T00:00:00.000Z'),
    })
  })

  it('accepts a selection of exactly the maximum span', () => {
    // June 1 through August 31 inclusive is 92 days. It measured 93 while the end
    // bound carried a time of day, so the longest legal pick was rejected.
    expect(() =>
      resolveUsageAnalyticsWindow({
        preset: 'custom',
        period: period(),
        customStart: new Date('2026-06-01'),
        customEnd: new Date('2026-08-31'),
        now,
      })
    ).not.toThrow()
  })

  it('refuses a custom range beyond the cap rather than scanning the ledger', () => {
    expect(() =>
      resolveUsageAnalyticsWindow({
        preset: 'custom',
        period: period(),
        customStart: new Date('2026-01-01T00:00:00.000Z'),
        customEnd: new Date('2026-08-01T00:00:00.000Z'),
        now,
      })
    ).toThrow(UsageWindowRangeTooLargeError)
  })

  it('falls back to the period when a custom range is missing a bound', () => {
    const window = resolveUsageAnalyticsWindow({ preset: 'custom', period: period(), now })
    expect(window.kind).toBe('period')
  })

  it('anchors custom bounds on midnight in the viewer calendar, not UTC', () => {
    // The picker offers calendar days. Anchoring on the UTC instant shifted every
    // non-UTC viewer's selection by their offset, and disagreed with the chart,
    // whose buckets are already the viewer's calendar days.
    const window = resolveUsageAnalyticsWindow({
      preset: 'custom',
      period: period(),
      customStart: new Date('2026-08-01'),
      customEnd: new Date('2026-08-31'),
      timezone: 'America/New_York',
      now,
    })
    expect(window.kind).toBe('range')
    if (window.kind === 'range') {
      // Midnight on Aug 1 in New York is 04:00 UTC (EDT, UTC-4).
      expect(window.from.toISOString()).toBe('2026-08-01T04:00:00.000Z')
      expect(window.to.toISOString()).toBe('2026-09-01T04:00:00.000Z')
    }
  })

  it('refuses a range that ends before it starts', () => {
    // Inverted bounds measured a negative span, passed the cap check, and produced a
    // range that matched nothing — indistinguishable from "no usage".
    expect(() =>
      resolveUsageAnalyticsWindow({
        preset: 'custom',
        period: period(),
        customStart: new Date('2026-08-31'),
        customEnd: new Date('2026-08-01'),
        now,
      })
    ).toThrow(UsageWindowRangeInvertedError)
  })

  it('shows a bounded window for a deployment with no subscription', () => {
    // `defaultBillingPeriod()` is the open pair 1970…9999. Rendered as a period it
    // produced 1,000 monthly buckets ending in 2053, stopped only by the densifier's
    // loop guard — reachable on self-hosted, where the panel opens without a plan.
    const window = resolveUsageAnalyticsWindow({
      preset: 'current-period',
      period: period({
        source: 'default',
        start: new Date(0),
        end: new Date(Date.UTC(9999, 11, 31)),
      }),
      now,
    })
    expect(window.kind).toBe('range')
    if (window.kind === 'range') {
      expect(window.to).toEqual(now)
      expect(Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000)).toBe(30)
    }
  })

  it('steps an unbounded period back by the display window, not by its own length', () => {
    const window = resolveUsageAnalyticsWindow({
      preset: 'previous-period',
      period: period({
        source: 'default',
        start: new Date(0),
        end: new Date(Date.UTC(9999, 11, 31)),
      }),
      now,
    })
    expect(window.kind).toBe('range')
    if (window.kind === 'range') {
      // Not 1970-minus-eight-millennia, which is what deriving it from the span gave.
      expect(window.from.getUTCFullYear()).toBe(2026)
    }
  })
})

describe('resolvePreviousPeriod', () => {
  it('returns null for a period with no derivation rule', () => {
    expect(resolvePreviousPeriod(period({ source: 'stripe' }))).toBeNull()
    expect(resolvePreviousPeriod(period({ source: 'default' }))).toBeNull()
  })
})

describe('resolveUsageBucket', () => {
  const from = new Date('2026-01-01T00:00:00.000Z')
  const days = (n: number) => new Date(from.getTime() + n * 24 * 60 * 60 * 1000)

  it('scales granularity with the window', () => {
    expect(resolveUsageBucket({ kind: 'range', from, to: days(30) })).toBe('day')
    expect(resolveUsageBucket({ kind: 'range', from, to: days(200) })).toBe('week')
    expect(resolveUsageBucket({ kind: 'range', from, to: days(500) })).toBe('month')
  })
})

describe('densifyUsageSeries', () => {
  const window = {
    kind: 'range' as const,
    from: new Date('2026-08-01T00:00:00.000Z'),
    to: new Date('2026-08-04T00:00:00.000Z'),
  }

  it('fills empty buckets with zero rather than omitting them', () => {
    // A period with no usage must draw a flat zero line; "No data" reads as a failure.
    const points = densifyUsageSeries(
      [{ bucketStart: '2026-08-02T00:00:00', cost: '1.50', events: 3 }],
      window,
      'day',
      'UTC'
    )
    expect(points).toHaveLength(3)
    expect(points.map((p) => p.cost)).toEqual([0, 1.5, 0])
    expect(points.map((p) => p.events)).toEqual([0, 3, 0])
  })

  it('preserves the window total', () => {
    const points = densifyUsageSeries(
      [
        { bucketStart: '2026-08-01T00:00:00', cost: '1.25', events: 1 },
        { bucketStart: '2026-08-03T00:00:00', cost: '2.75', events: 2 },
      ],
      window,
      'day',
      'UTC'
    )
    expect(points.reduce((sum, p) => sum + p.cost, 0)).toBeCloseTo(4, 8)
  })

  it('emits an empty series for a zero-length window instead of looping', () => {
    expect(
      densifyUsageSeries([], { kind: 'range', from: window.from, to: window.from }, 'day', 'UTC')
    ).toEqual([])
  })

  it('keys days by the viewer calendar the query grouped by, not UTC', () => {
    // Auckland is UTC+12, so the window's final instant is already the next local
    // day. Walking UTC dates dropped that bucket: its cost stayed in the headline
    // while its bar was never drawn.
    const points = densifyUsageSeries(
      [{ bucketStart: '2026-08-04T00:00:00', cost: '5.00', events: 1 }],
      window,
      'day',
      'Pacific/Auckland'
    )
    const keys = points.map((p) => p.timestamp.slice(0, 10))
    expect(keys).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
    expect(points.at(-1)?.cost).toBe(5)
  })

  it('aligns week buckets to Monday, as `date_trunc` does', () => {
    // A period starting mid-week previously produced keys Postgres never emits, so
    // every bar read zero while the total was correct. Reachable through an annual
    // enterprise period, which resolves to `week`.
    const points = densifyUsageSeries(
      [{ bucketStart: '2026-08-10T00:00:00', cost: '9.00', events: 4 }],
      // 2026-08-15 is a Saturday; its ISO week starts Monday 2026-08-10.
      {
        kind: 'range',
        from: new Date('2026-08-15T00:00:00.000Z'),
        to: new Date('2026-08-29T00:00:00.000Z'),
      },
      'week',
      'UTC'
    )
    expect(points.map((p) => p.timestamp.slice(0, 10))).toEqual([
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
    ])
    expect(points[0].cost).toBe(9)
  })

  it('aligns month buckets to the first, as `date_trunc` does', () => {
    const points = densifyUsageSeries(
      [{ bucketStart: '2026-09-01T00:00:00', cost: '3.00', events: 2 }],
      {
        kind: 'range',
        from: new Date('2026-08-15T00:00:00.000Z'),
        to: new Date('2026-10-15T00:00:00.000Z'),
      },
      'month',
      'UTC'
    )
    expect(points.map((p) => p.timestamp.slice(0, 10))).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ])
    expect(points[1].cost).toBe(3)
  })
})

describe('foldUsageBreakdown', () => {
  const rows = [
    { key: 'a', cost: '5', events: 5 },
    { key: 'b', cost: '3', events: 3 },
    { key: 'c', cost: '2', events: 2 },
  ]
  const labelFor = (key: string | null) => key ?? 'Unattributed'

  it('reconciles visible rows plus the remainder to the total', () => {
    const fold = foldUsageBreakdown(rows, 10, labelFor, 2)
    const visible = fold.rows.reduce((sum, row) => sum + row.cost, 0)
    expect(visible + fold.other.cost).toBeCloseTo(fold.totalCost, 8)
    expect(fold.other.rowCount).toBe(1)
  })

  it('ranks by cost descending', () => {
    expect(foldUsageBreakdown(rows, 10, labelFor, 3).rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('computes share against the window total, not the visible subset', () => {
    // Sharing against the visible rows would make a truncated list read as 100%.
    const fold = foldUsageBreakdown(rows, 10, labelFor, 1)
    expect(fold.rows[0].share).toBeCloseTo(0.5, 8)
  })

  it('labels a null grouping key rather than dropping the row', () => {
    const fold = foldUsageBreakdown([{ key: null, cost: '4', events: 1 }], 4, labelFor, 5)
    expect(fold.rows[0].label).toBe('Unattributed')
  })

  it('yields zero shares when nothing was spent, without dividing by zero', () => {
    const fold = foldUsageBreakdown([{ key: 'a', cost: '0', events: 2 }], 0, labelFor, 5)
    expect(fold.rows[0].share).toBe(0)
  })

  it('carries the omitted rows tokens, so a zero-cost dimension still adds up', () => {
    // BYOK ranks by a cost that is zero for every row, so which rows land in the
    // visible slice is effectively arbitrary — dropping the tail's tokens would
    // hide real volume behind an em dash.
    const byokRows = [
      { key: 'gpt-4o', cost: '0', events: 1, inputTokens: 100, outputTokens: 50 },
      { key: 'claude', cost: '0', events: 1, inputTokens: 700, outputTokens: 300 },
      { key: 'gemini', cost: '0', events: 1, inputTokens: 20, outputTokens: 5 },
    ]
    const fold = foldUsageBreakdown(byokRows, 0, labelFor, 1, 'tokens')
    // Ranked by tokens, so the biggest provider is the one shown...
    expect(fold.rows.map((row) => row.id)).toEqual(['claude'])
    // ...and the tail's tokens are still accounted for rather than hidden.
    expect(fold.other.rowCount).toBe(2)
    expect(fold.other.tokens).toBe(175)
  })
})

describe('MAX_CUSTOM_RANGE_DAYS', () => {
  it('is the documented cap', () => {
    expect(MAX_CUSTOM_RANGE_DAYS).toBe(92)
  })
})

describe('mergeRowsByKey', () => {
  it('collapses sources that share a display label', () => {
    // The ledger stores `copilot` and `workspace-chat` separately but both render as
    // "Sim Chat", so grouping on the raw column alone shipped the label twice with the
    // usage split between the rows — and ranked both below their true position.
    const merged = mergeRowsByKey(
      [
        { key: 'copilot', cost: '0.0295', events: 2 },
        { key: 'workspace-chat', cost: '23.3967', events: 40 },
        { key: 'workflow', cost: '0.9333', events: 130 },
      ],
      (key) => (key === 'copilot' || key === 'workspace-chat' ? 'sim-chat' : key)
    )

    expect(merged).toHaveLength(2)
    const simChat = merged.find((row) => row.key === 'sim-chat')
    expect(Number(simChat?.cost)).toBeCloseTo(23.4262, 8)
    expect(simChat?.events).toBe(42)
  })

  it('sums token columns alongside cost', () => {
    const merged = mergeRowsByKey(
      [
        { key: 'claude-opus-4.8', cost: '1', events: 1, inputTokens: 100, outputTokens: 10 },
        { key: 'claude-sonnet-4', cost: '2', events: 3, inputTokens: 50, outputTokens: 5 },
      ],
      () => 'anthropic'
    )

    expect(merged).toEqual([
      { key: 'anthropic', cost: 3, events: 4, inputTokens: 150, outputTokens: 15 },
    ])
  })

  it('preserves a null key rather than merging it into a named row', () => {
    const merged = mergeRowsByKey(
      [
        { key: null, cost: '1', events: 1 },
        { key: 'a', cost: '2', events: 1 },
      ],
      (key) => key
    )
    expect(merged.map((row) => row.key)).toEqual([null, 'a'])
  })

  it('leaves totals unchanged', () => {
    const rows = [
      { key: 'a', cost: '1.5', events: 1 },
      { key: 'b', cost: '2.5', events: 2 },
      { key: 'c', cost: '3', events: 3 },
    ]
    const before = rows.reduce((sum, row) => sum + Number(row.cost), 0)
    const after = mergeRowsByKey(rows, (key) => (key === 'c' ? 'c' : 'ab')).reduce(
      (sum, row) => sum + Number(row.cost),
      0
    )
    expect(after).toBeCloseTo(before, 8)
  })
})
