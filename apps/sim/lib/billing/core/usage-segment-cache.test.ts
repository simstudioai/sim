import { generateShortId } from '@sim/utils/id'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redisMock.client }))

import { type UsageSegment, usageHourKey } from '@/lib/billing/core/usage-analytics'
import { readThroughSegments } from '@/lib/billing/core/usage-segment-cache'

const HOUR = 3_600_000

function day(key: string, settled = true): UsageSegment {
  const from = new Date(`${key}T00:00:00.000Z`)
  return { key, day: key, from, to: new Date(from.getTime() + 24 * HOUR), settled }
}

function hours(key: string, settledThrough: number): UsageSegment[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const from = new Date(new Date(`${key}T00:00:00.000Z`).getTime() + hour * HOUR)
    return {
      key: usageHourKey(key, hour),
      day: key,
      from,
      to: new Date(from.getTime() + HOUR),
      settled: hour <= settledThrough,
    }
  })
}

/** One unit per hour in the requested range, keyed by its UTC hour — like the SQL. */
const fetchRange = vi.fn(async (from: Date, to: Date) => {
  const result = new Map<string, number>()
  for (let time = from.getTime(); time < to.getTime(); time += HOUR) {
    const instant = new Date(time)
    result.set(usageHourKey(instant.toISOString().slice(0, 10), instant.getUTCHours()), 1)
  }
  return result
})

describe('readThroughSegments', () => {
  let namespace: string
  const read = (segments: UsageSegment[]) =>
    readThroughSegments({
      namespace,
      segments,
      fetchRange,
      combine: (values: number[]) => values.reduce((sum, value) => sum + value, 0),
      empty: 0,
      ttlMs: 60_000,
    })
  const totalByDay = (entries: [string, number][]) =>
    entries.reduce<Record<string, number>>((sum, [key, value]) => {
      sum[key] = (sum[key] ?? 0) + value
      return sum
    }, {})

  beforeEach(() => {
    redisMock.client = null
    namespace = `test-${generateShortId()}`
  })

  it('reads the ledger when a stored entry does not parse, rather than failing', async () => {
    redisMock.client = {
      mget: async (...keys: string[]) => keys.map(() => '{not json'),
      pipeline: () => ({ set: () => undefined, exec: async () => [] }),
    }
    const entries = await read([day('2026-01-05')])
    expect(fetchRange).toHaveBeenCalledTimes(1)
    expect(totalByDay(entries)).toEqual({ '2026-01-05': 24 })
  })

  it('reads every missing segment in one merged range and counts each hour once', async () => {
    const segments = [day('2026-01-01'), ...hours('2026-01-02', 10)]
    const entries = await read(segments)
    expect(fetchRange).toHaveBeenCalledTimes(1)
    expect(fetchRange).toHaveBeenCalledWith(segments[0]?.from, segments.at(-1)?.to)
    expect(totalByDay(entries)).toEqual({ '2026-01-01': 24, '2026-01-02': 24 })
  })

  it('serves settled segments from the cache and re-reads only the open hours', async () => {
    const segments = [day('2026-01-01'), ...hours('2026-01-02', 10)]
    await read(segments)
    fetchRange.mockClear()

    const entries = await read(segments)
    expect(fetchRange).toHaveBeenCalledTimes(1)
    expect(fetchRange).toHaveBeenCalledWith(segments[12]?.from, segments.at(-1)?.to)
    expect(totalByDay(entries)).toEqual({ '2026-01-01': 24, '2026-01-02': 24 })
  })

  it('assembles a newly settled day from its cached hours without a ledger read', async () => {
    await read(hours('2026-01-02', 23))
    fetchRange.mockClear()

    expect(totalByDay(await read([day('2026-01-02')]))).toEqual({ '2026-01-02': 24 })
    expect(fetchRange).not.toHaveBeenCalled()
  })

  it('serves but never stores a value that can still change', async () => {
    const final = (value: number) => value < 100
    const readVetoed = () =>
      readThroughSegments({
        namespace,
        segments: [day('2026-01-04')],
        fetchRange: async () => new Map([[usageHourKey('2026-01-04', 3), 100]]),
        combine: (values: number[]) => values.reduce((sum, value) => sum + value, 0),
        isFinal: final,
        empty: 0,
        ttlMs: 60_000,
      })
    expect(await readVetoed()).toEqual([['2026-01-04', 100]])
    const refetch = vi.fn(async () => new Map([[usageHourKey('2026-01-04', 3), 5]]))
    const entries = await readThroughSegments({
      namespace,
      segments: [day('2026-01-04')],
      fetchRange: refetch,
      combine: (values: number[]) => values.reduce((sum, value) => sum + value, 0),
      isFinal: final,
      empty: 0,
      ttlMs: 60_000,
    })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(entries).toEqual([['2026-01-04', 5]])
  })

  it('never caches an unsettled segment', async () => {
    await read(hours('2026-01-03', -1))
    fetchRange.mockClear()
    await read(hours('2026-01-03', -1))
    expect(fetchRange).toHaveBeenCalledTimes(1)
  })
})
