import { describe, expect, it } from 'vitest'
import {
  buildUsageBuckets,
  type ExecutionDayRow,
  type LedgerDayRow,
  reportWindow,
  utcDayKey,
} from '@/lib/onprem-telemetry/collect'

describe('reportWindow', () => {
  it('spans the trailing N UTC days including the current, partial one', () => {
    const window = reportWindow(new Date('2026-09-27T15:42:00Z'), 3)
    expect(window.start.toISOString()).toBe('2026-09-25T00:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-09-28T00:00:00.000Z')
  })

  it('keys days by UTC date regardless of local time', () => {
    expect(utcDayKey(new Date('2026-09-27T23:59:59.999Z'))).toBe('2026-09-27')
    expect(utcDayKey(new Date('2026-09-28T00:00:00.000Z'))).toBe('2026-09-28')
  })
})

describe('buildUsageBuckets', () => {
  const window = reportWindow(new Date('2026-09-27T12:00:00Z'), 2)

  const ledger: LedgerDayRow[] = [
    /** Base execution charges: 40 runs × $0.005 = 40 credits. */
    {
      day: '2026-09-26',
      source: 'workflow',
      category: 'fixed',
      description: 'Base execution charge',
      events: 40,
      cost: '0.2',
      inputTokens: 0,
      outputTokens: 0,
    },
    /** BYOK model usage: tokens with zero cost. */
    {
      day: '2026-09-26',
      source: 'workflow',
      category: 'model_unbilled',
      description: 'gpt-5',
      events: 35,
      cost: '0',
      inputTokens: 120_000,
      outputTokens: 30_000,
    },
    /** A hosted-key model: cost and tokens both present. */
    {
      day: '2026-09-26',
      source: 'knowledge-base',
      category: 'model',
      description: 'text-embedding-3-small',
      events: 5,
      cost: '0.01',
      inputTokens: 50_000,
      outputTokens: 0,
    },
    /** Outside the window: dropped, not mis-filed. */
    {
      day: '2026-09-01',
      source: 'workflow',
      category: 'fixed',
      description: 'Base execution charge',
      events: 999,
      cost: '5',
      inputTokens: 0,
      outputTokens: 0,
    },
  ]

  const executions: ExecutionDayRow[] = [
    { day: '2026-09-26', status: 'completed', executions: 37, durationMs: 111_000 },
    { day: '2026-09-26', status: 'failed', executions: 3, durationMs: 9_000 },
    { day: '2026-09-27', status: 'running', executions: 1, durationMs: 0 },
  ]

  it('emits one bucket per day in the window, zero-filled when idle', () => {
    const buckets = buildUsageBuckets(window, [], [])
    expect(buckets.map((b) => b.periodStart)).toEqual([
      '2026-09-26T00:00:00.000Z',
      '2026-09-27T00:00:00.000Z',
    ])
    expect(buckets[0].periodEnd).toBe('2026-09-27T00:00:00.000Z')
    expect(buckets[0]).toMatchObject({ workflowExecutions: 0, credits: 0, sources: [], models: [] })
  })

  it('converts ledger dollars to credits and folds tokens out of model rows', () => {
    const [day26, day27] = buildUsageBuckets(window, ledger, executions)

    expect(day26.credits).toBe(42)
    expect(day26.inputTokens).toBe(170_000)
    expect(day26.outputTokens).toBe(30_000)
    expect(day26.workflowExecutions).toBe(40)
    expect(day26.workflowExecutionsFailed).toBe(3)
    expect(day26.workflowDurationMs).toBe(120_000)

    expect(day26.sources).toEqual([
      { source: 'workflow', category: 'fixed', events: 40, credits: 40 },
      { source: 'workflow', category: 'model_unbilled', events: 35, credits: 0 },
      { source: 'knowledge-base', category: 'model', events: 5, credits: 2 },
    ])
    expect(day26.models).toEqual([
      { model: 'gpt-5', events: 35, inputTokens: 120_000, outputTokens: 30_000, credits: 0 },
      {
        model: 'text-embedding-3-small',
        events: 5,
        inputTokens: 50_000,
        outputTokens: 0,
        credits: 2,
      },
    ])

    expect(day27).toMatchObject({ workflowExecutions: 1, credits: 0 })
  })

  it('never carries a description for non-model categories', () => {
    const [day26] = buildUsageBuckets(window, ledger, executions)
    expect(JSON.stringify(day26)).not.toContain('Base execution charge')
  })
})
