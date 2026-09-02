/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applyRecencyBoost,
  RECENCY_HALF_LIFE_DAYS,
  recencyFreshness,
} from '@/lib/knowledge/search/recency'

const NOW = new Date('2026-09-01T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

describe('recencyFreshness', () => {
  it('is 1 now, halves at the half-life, and is 0 without a modified time', () => {
    expect(recencyFreshness(NOW, NOW)).toBe(1)
    expect(recencyFreshness(daysAgo(RECENCY_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5)
    expect(recencyFreshness(null, NOW)).toBe(0)
    expect(recencyFreshness(undefined, NOW)).toBe(0)
  })

  it('gives a future-dated document no boost rather than an inflated one', () => {
    expect(recencyFreshness(daysAgo(-1), NOW)).toBe(0)
  })
})

describe('applyRecencyBoost', () => {
  const row = (id: string, sourceModifiedAt: Date | null) => ({ id, sourceModifiedAt })

  it('keeps rank order when nothing carries a modified time', () => {
    const rows = [row('a', null), row('b', null), row('c', null)]
    expect(applyRecencyBoost(rows, NOW).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('lets a fresh document edge past a stale neighbour but not climb from the bottom', () => {
    const rows = [
      row('stale-1', daysAgo(400)),
      row('fresh-2', NOW),
      ...Array.from({ length: 30 }, (_, i) => row(`mid-${i + 3}`, daysAgo(400))),
      row('fresh-last', NOW),
    ]
    const ordered = applyRecencyBoost(rows, NOW).map((r) => r.id)
    expect(ordered[0]).toBe('fresh-2')
    expect(ordered[1]).toBe('stale-1')
    expect(ordered.indexOf('fresh-last')).toBeGreaterThan(20)
  })

  it('does not mutate its input', () => {
    const rows = [row('a', daysAgo(400)), row('b', NOW)]
    applyRecencyBoost(rows, NOW)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
