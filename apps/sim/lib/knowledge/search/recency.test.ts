import { describe, expect, it } from 'vitest'
import { applyRecencyBoost, recencyFreshness } from '@/lib/knowledge/search/recency'

const NOW = new Date('2026-09-01T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

describe('recencyFreshness', () => {
  it('gives a future-dated document no boost rather than an inflated one', () => {
    expect(recencyFreshness(daysAgo(-1), NOW)).toBe(0)
  })
})

describe('applyRecencyBoost', () => {
  const row = (id: string, sourceModifiedAt: Date | null) => ({ id, sourceModifiedAt })

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
})
