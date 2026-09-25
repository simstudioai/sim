import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { organizationSearchStatsQuerySchema } from '@/lib/api/contracts/knowledge/search-stats'
import { getSearchStatsRangeError, getSearchStatsWindow } from '@/lib/knowledge/search/stats'

const now = new Date('2026-09-10T20:00:00.000Z')
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe('Search stats window and contract', () => {
  it('includes the last custom day with an exclusive next-midnight bound', () => {
    expect(
      getSearchStatsWindow('custom', now, { startDate: '2026-08-31', endDate: '2026-09-02' })
    ).toEqual({
      start: new Date('2026-08-31T00:00:00.000Z'),
      end: new Date('2026-09-03T00:00:00.000Z'),
      days: 3,
    })
    expect(
      getSearchStatsWindow('custom', now, { startDate: '2026-09-10', endDate: '2026-09-10' })
    ).toEqual({
      start: new Date('2026-09-10T00:00:00.000Z'),
      end: now,
      days: 1,
    })
  })
  it.each([
    { startDate: '2026-09-01' },
    { endDate: '2026-09-01' },
    { startDate: '2026-02-29', endDate: '2026-03-01' },
    { startDate: '2026-04-31', endDate: '2026-05-01' },
    { startDate: '2026-9-01', endDate: '2026-09-02' },
    { startDate: '2026-09-03', endDate: '2026-09-02' },
    { startDate: '2026-09-10', endDate: '2026-09-11' },
    { startDate: '2026-06-12', endDate: '2026-09-10' },
  ])('rejects invalid or unbounded custom ranges: %j', (range) => {
    expect(getSearchStatsRangeError(range, now)).not.toBeNull()
    expect(
      organizationSearchStatsQuerySchema.safeParse({
        organizationId: 'org',
        period: 'custom',
        ...range,
      }).success
    ).toBe(false)
    expect(() => getSearchStatsWindow('custom', now, range)).toThrow()
  })
  it('bounds scans and rejects caller-supplied surfaces', () => {
    expect(
      organizationSearchStatsQuerySchema.safeParse({ organizationId: 'org', period: '365d' })
        .success
    ).toBe(false)
    expect(
      organizationSearchStatsQuerySchema.safeParse({ organizationId: 'org', surface: 'forged' })
        .success
    ).toBe(false)
    expect(organizationSearchStatsQuerySchema.parse({ organizationId: 'org' })).toEqual({
      organizationId: 'org',
      period: '30d',
    })
  })
})
