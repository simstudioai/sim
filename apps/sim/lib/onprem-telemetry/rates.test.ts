import { describe, expect, it } from 'vitest'
import {
  creditsToUsd,
  type EffectiveRate,
  resolveRateAt,
  valueUsage,
} from '@/lib/onprem-telemetry/rates'

function rate(id: string, usdPerCredit: number, effectiveFrom: string, createdAt = effectiveFrom) {
  return {
    id,
    usdPerCredit,
    effectiveFrom: new Date(effectiveFrom),
    createdAt: new Date(createdAt),
  } satisfies EffectiveRate
}

describe('resolveRateAt', () => {
  const rates = [
    rate('r1', 0.005, '2026-01-01T00:00:00Z'),
    rate('r2', 0.004, '2026-03-01T00:00:00Z'),
  ]

  it('picks the latest rate whose effectiveFrom is not after the instant', () => {
    expect(resolveRateAt(rates, new Date('2026-02-15T00:00:00Z'))?.id).toBe('r1')
    expect(resolveRateAt(rates, new Date('2026-03-01T00:00:00Z'))?.id).toBe('r2')
    expect(resolveRateAt(rates, new Date('2026-09-01T00:00:00Z'))?.id).toBe('r2')
  })

  it('returns null before the first rate rather than guessing', () => {
    expect(resolveRateAt(rates, new Date('2025-12-31T23:59:59Z'))).toBeNull()
    expect(resolveRateAt([], new Date())).toBeNull()
  })

  it('is independent of input order', () => {
    expect(resolveRateAt([...rates].reverse(), new Date('2026-02-15T00:00:00Z'))?.id).toBe('r1')
  })

  it('lets a later-created rate win a tie on effectiveFrom', () => {
    const corrected = [
      rate('typo', 0.5, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      rate('fix', 0.005, '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'),
    ]
    expect(resolveRateAt(corrected, new Date('2026-04-01T00:00:00Z'))?.id).toBe('fix')
  })

  it('re-values covered history when a rate is backdated, and nothing else', () => {
    const jan = new Date('2026-01-15T00:00:00Z')
    const apr = new Date('2026-04-15T00:00:00Z')
    expect(resolveRateAt(rates, jan)?.usdPerCredit).toBe(0.005)
    const backdated = [...rates, rate('r0', 0.001, '2025-06-01T00:00:00Z', '2026-05-01T00:00:00Z')]
    /** January is now covered by r0's window... */
    expect(resolveRateAt(backdated, new Date('2025-12-01T00:00:00Z'))?.id).toBe('r0')
    /** ...but January itself still resolves to r1, which started later than r0. */
    expect(resolveRateAt(backdated, jan)?.id).toBe('r1')
    expect(resolveRateAt(backdated, apr)?.id).toBe('r2')
  })
})

describe('creditsToUsd', () => {
  it('multiplies and rounds to micro-dollars', () => {
    expect(creditsToUsd(1000, rate('r', 0.005, '2026-01-01T00:00:00Z'))).toBe(5)
    expect(creditsToUsd(3, rate('r', 0.0033333, '2026-01-01T00:00:00Z'))).toBe(0.01)
  })

  it('is null without a rate', () => {
    expect(creditsToUsd(1000, null)).toBeNull()
  })
})

describe('valueUsage', () => {
  it('attaches the applicable rate and derived dollars to each row', () => {
    const rates = [rate('r1', 0.005, '2026-01-01T00:00:00Z')]
    const rows = [
      { periodStart: new Date('2025-12-31T00:00:00Z'), credits: 200 },
      { periodStart: new Date('2026-01-01T00:00:00Z'), credits: 200 },
    ]
    const valued = valueUsage(rows, rates)
    expect(valued[0]).toMatchObject({ rate: null, usd: null })
    expect(valued[1]).toMatchObject({ rate: { id: 'r1' }, usd: 1 })
    /** Credits are never rewritten by valuation. */
    expect(valued.map((v) => v.row.credits)).toEqual([200, 200])
  })
})
