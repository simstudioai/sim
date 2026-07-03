/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { trimRowsToByteBudget } from '@/lib/table/rows/paging'

function row(id: string, bytes: number) {
  // {"b":"aaa…"} serializes to bytes + 8 chars of envelope.
  return { id, data: { b: 'a'.repeat(Math.max(0, bytes - 8)) } }
}

describe('trimRowsToByteBudget', () => {
  it('returns all rows when they fit the budget', () => {
    const rows = [row('r1', 100), row('r2', 100)]
    expect(trimRowsToByteBudget(rows, 1000)).toBe(rows)
  })

  it('keeps the longest prefix within the budget', () => {
    const rows = [row('r1', 400), row('r2', 400), row('r3', 400)]
    const kept = trimRowsToByteBudget(rows, 900)
    expect(kept.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('always keeps the first row even when it alone exceeds the budget', () => {
    const rows = [row('r1', 5000), row('r2', 100)]
    const kept = trimRowsToByteBudget(rows, 1000)
    expect(kept.map((r) => r.id)).toEqual(['r1'])
  })

  it('returns empty input unchanged', () => {
    expect(trimRowsToByteBudget([], 1000)).toEqual([])
  })
})
