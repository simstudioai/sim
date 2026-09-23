import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { randomInt } from '@sim/utils/random'
import { LRUCache } from 'lru-cache'
import { type UsageSegment, usageHourKey } from '@/lib/billing/core/usage-analytics'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('UsageSegmentCache')

/**
 * Expiry is jittered by up to this much, so a year of days written by one cold load
 * does not expire — and get recomputed — all at once.
 */
const TTL_JITTER_RATIO = 0.5

/**
 * How long an hour is kept. An hour is only read until its day settles and is
 * assembled from it, so it outlives that by a margin rather than by the day's TTL.
 */
const HOUR_TTL_MS = 36 * 60 * 60 * 1000

/**
 * The most recently settled days assembled from their cached hours. Only the day or
 * two since the last view can still be held hour by hour; asking for older ones
 * would only fetch keys that expired long ago.
 */
const ASSEMBLE_DAY_LIMIT = 2

/**
 * Cached runs this short between two stretches that must be read anyway are read
 * with them: one wider scan costs less than another round trip, and jittered expiry
 * otherwise scatters a window into many small queries.
 */
const MERGE_GAP_SEGMENTS = 2

/** Bump when a cached value's shape or meaning changes; old entries are then ignored. */
const KEY_VERSION = 'v1'

/**
 * The in-process fallback for deployments without Redis, bounded by bytes: a
 * member or model entry can run to tens of kilobytes.
 */
const localSegments = new LRUCache<string, string>({
  max: 50_000,
  maxSize: 64 * 1024 * 1024,
  sizeCalculation: (value) => value.length,
})

async function readStored(keys: string[]): Promise<(string | null)[]> {
  if (keys.length === 0) return []
  const redis = getRedisClient()
  if (!redis) return keys.map((key) => localSegments.get(key) ?? null)
  try {
    return await redis.mget(...keys)
  } catch (error) {
    logger.warn('Usage segment cache read failed; reading the ledger', {
      error: getErrorMessage(error),
    })
    return keys.map(() => null)
  }
}

/** Fire-and-forget: a page never waits on, or fails because of, a cache write. */
function writeStored(entries: { key: string; value: string; ttlMs: number }[]): void {
  if (entries.length === 0) return
  const jittered = (ttlMs: number) => ttlMs + randomInt(0, Math.floor(ttlMs * TTL_JITTER_RATIO))
  const redis = getRedisClient()
  if (!redis) {
    for (const { key, value, ttlMs } of entries)
      localSegments.set(key, value, { ttl: jittered(ttlMs) })
    return
  }
  const pipeline = redis.pipeline()
  for (const { key, value, ttlMs } of entries) pipeline.set(key, value, 'PX', jittered(ttlMs))
  pipeline.exec().catch((error: unknown) => {
    logger.warn('Usage segment cache write failed', { error: getErrorMessage(error) })
  })
}

interface ReadThroughSegmentsArgs<T> {
  /** Everything a value depends on besides its segment: entity, scope, timezone, dimension. */
  namespace: string
  segments: UsageSegment[]
  /** Aggregates one contiguous range, keyed by the viewer's local hour (`YYYY-MM-DDTHH`). */
  fetchRange: (from: Date, to: Date) => Promise<Map<string, T>>
  /** Folds several stretches' aggregates into one, to store a day as a single entry. */
  combine: (values: T[]) => T
  /**
   * Whether a fetched value can no longer change. One that can is served but never
   * stored, whatever the clock says — so a stretch still holding a running execution
   * is read again next time rather than cached as it looked mid-run.
   */
  isFinal?: (value: T) => boolean
  /** The value of a segment with no rows, which is cached like any other. */
  empty: T
  /**
   * How long a settled day is kept. Not a freshness bound for data that cannot
   * change — it is how long anything the settle lag missed can survive.
   */
  ttlMs: number
}

/**
 * Aggregates for a window, from the cache where a segment has settled and the
 * ledger otherwise, as `[day, value]` entries — a day can appear more than once.
 *
 * Every segment the cache cannot answer is read in as few ranges as possible:
 * adjacent segments merge, so a cold load is still one scan of the window rather
 * than one per day. Each fetched hour is returned exactly once, under its own day,
 * whichever segment it is cached in. A cache failure costs a ledger read, never a
 * page.
 */
export async function readThroughSegments<T>({
  namespace,
  segments,
  fetchRange,
  combine,
  isFinal = () => true,
  empty,
  ttlMs,
}: ReadThroughSegmentsArgs<T>): Promise<[string, T][]> {
  const keyOf = (segmentKey: string) => `usage-segment:${KEY_VERSION}:${namespace}:${segmentKey}`
  const settled = segments.filter((segment) => segment.settled)

  /**
   * A day that has just settled was, until now, cached hour by hour. Its hours are
   * asked for in the same round trip as everything else, so assembling it spares the
   * full-day rescan the first view after midnight would otherwise pay.
   */
  const assemblable = settled
    .filter((segment) => segment.key === segment.day)
    .slice(-ASSEMBLE_DAY_LIMIT)
  const hourKeys = assemblable.flatMap((segment) =>
    Array.from({ length: 24 }, (_, hour) => usageHourKey(segment.day, hour))
  )
  const stored = await readStored(
    [...settled, ...hourKeys].map((item) => keyOf(typeof item === 'string' ? item : item.key))
  )
  const storedHours = stored.slice(settled.length)

  const writes: { key: string; value: string; ttlMs: number }[] = []
  const cached = new Map<UsageSegment, T>()
  settled.forEach((segment, index) => {
    const value = stored[index]
    if (value != null) cached.set(segment, JSON.parse(value) as T)
  })
  assemblable.forEach((segment, index) => {
    if (cached.has(segment)) return
    const hours = storedHours.slice(index * 24, index * 24 + 24)
    if (hours.some((hour) => hour == null)) return
    const value = combine(hours.map((hour) => JSON.parse(hour as string) as T))
    cached.set(segment, value)
    writes.push({ key: keyOf(segment.key), value: JSON.stringify(value), ttlMs })
  })

  const readAnyway = new Set(segments.filter((segment) => !cached.has(segment)))
  let run: UsageSegment[] = []
  for (const [index, segment] of segments.entries()) {
    if (cached.has(segment)) {
      run.push(segment)
      continue
    }
    const bounded = run.length > 0 && index - run.length > 0
    if (bounded && run.length <= MERGE_GAP_SEGMENTS) for (const gap of run) readAnyway.add(gap)
    run = []
  }

  const ranges: { from: Date; to: Date }[] = []
  for (const segment of segments) {
    if (!readAnyway.has(segment)) continue
    const last = ranges[ranges.length - 1]
    if (last && last.to.getTime() === segment.from.getTime()) last.to = segment.to
    else ranges.push({ from: segment.from, to: segment.to })
  }
  const hours = (
    await Promise.all(ranges.map((range) => fetchRange(range.from, range.to)))
  ).flatMap((fetched) => [...fetched])

  const entries: [string, T][] = []
  for (const [segment, value] of cached) {
    if (!readAnyway.has(segment)) entries.push([segment.day, value])
  }
  const byHour = new Map(hours)
  const byDay = new Map<string, T[]>()
  for (const [hour, value] of hours) {
    entries.push([hour.slice(0, 10), value])
    const day = hour.slice(0, 10)
    const values = byDay.get(day)
    if (values) values.push(value)
    else byDay.set(day, [value])
  }

  for (const segment of readAnyway) {
    if (!segment.settled || cached.has(segment)) continue
    const isDay = segment.key === segment.day
    const parts = isDay ? (byDay.get(segment.day) ?? []) : [byHour.get(segment.key) ?? empty]
    if (!parts.every(isFinal)) continue
    const value = isDay ? combine(parts) : (parts[0] ?? empty)
    writes.push({
      key: keyOf(segment.key),
      value: JSON.stringify(value),
      ttlMs: isDay ? ttlMs : HOUR_TTL_MS,
    })
  }
  writeStored(writes)
  return entries
}
