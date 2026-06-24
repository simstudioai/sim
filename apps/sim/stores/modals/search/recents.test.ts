/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { frecencyScore, useSearchRecentsStore } from '@/stores/modals/search/recents'

const DAY_MS = 24 * 60 * 60 * 1000

describe('frecencyScore', () => {
  const now = 1_000_000_000_000

  it('ranks a more frequent item above a less frequent one used at the same time', () => {
    const frequent = frecencyScore({ count: 5, lastUsedAt: now }, now)
    const rare = frecencyScore({ count: 1, lastUsedAt: now }, now)
    expect(frequent).toBeGreaterThan(rare)
  })

  it('ranks a more recent item above an older one of equal frequency', () => {
    const recent = frecencyScore({ count: 3, lastUsedAt: now }, now)
    const stale = frecencyScore({ count: 3, lastUsedAt: now - 14 * DAY_MS }, now)
    expect(recent).toBeGreaterThan(stale)
  })

  it('decays an old frequent item below a fresh single use (frequency × recency)', () => {
    const freshOnce = frecencyScore({ count: 1, lastUsedAt: now }, now)
    const oldOften = frecencyScore({ count: 5, lastUsedAt: now - 30 * DAY_MS }, now)
    expect(freshOnce).toBeGreaterThan(oldOften)
  })

  it('halves the weight every 7 days', () => {
    const fresh = frecencyScore({ count: 1, lastUsedAt: now }, now)
    const weekOld = frecencyScore({ count: 1, lastUsedAt: now - 7 * DAY_MS }, now)
    expect(weekOld).toBeCloseTo(fresh / 2, 5)
  })
})

describe('useSearchRecentsStore', () => {
  beforeEach(() => {
    useSearchRecentsStore.setState({ entries: {} })
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records a new selection with count 1', () => {
    useSearchRecentsStore.getState().record('tool:slack')
    expect(useSearchRecentsStore.getState().entries['tool:slack']).toEqual({
      count: 1,
      lastUsedAt: 1_000,
    })
  })

  it('bumps frequency and recency on repeat selection', () => {
    useSearchRecentsStore.getState().record('tool:slack')
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    useSearchRecentsStore.getState().record('tool:slack')
    expect(useSearchRecentsStore.getState().entries['tool:slack']).toEqual({
      count: 2,
      lastUsedAt: 2_000,
    })
  })

  it('prunes to the 50 most-recently-used entries', () => {
    for (let i = 0; i < 60; i++) {
      vi.spyOn(Date, 'now').mockReturnValue(i)
      useSearchRecentsStore.getState().record(`tool:item-${i}`)
    }
    const { entries } = useSearchRecentsStore.getState()
    expect(Object.keys(entries)).toHaveLength(50)
    expect(entries['tool:item-0']).toBeUndefined()
    expect(entries['tool:item-9']).toBeUndefined()
    expect(entries['tool:item-10']).toBeDefined()
    expect(entries['tool:item-59']).toBeDefined()
  })

  it('clears all entries', () => {
    useSearchRecentsStore.getState().record('block:agent')
    useSearchRecentsStore.getState().clear()
    expect(useSearchRecentsStore.getState().entries).toEqual({})
  })
})
