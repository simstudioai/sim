import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  ANALYTICS_MAX_ROWS,
  type AnalyticsBucket,
  type AnalyticsQuery,
  type AnalyticsValue,
} from '@/lib/table/analytics/schema'

const BUCKET_SECONDS: Record<AnalyticsBucket, number> = {
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2419200,
  year: 31536000,
}

export function resolveAnalyticsBucket(query: AnalyticsQuery): AnalyticsBucket | null {
  if (!query.groupBy?.includes(query.timeField ?? 'createdAt')) return null
  const seconds = (Date.parse(query.to) - Date.parse(query.from)) / 1000
  if (query.bucket && query.bucket !== 'auto') {
    if (seconds / BUCKET_SECONDS[query.bucket] > ANALYTICS_MAX_ROWS) {
      throw new OrchestrationError(
        'validation',
        'Too many time buckets. Choose a larger bucket or a shorter range.'
      )
    }
    return query.bucket
  }
  return (
    (Object.entries(BUCKET_SECONDS).find(([, size]) => seconds / size <= 90)?.[0] as
      | AnalyticsBucket
      | undefined) ?? 'year'
  )
}

/** Matches PostgreSQL date_trunc in UTC, including Monday-start weeks and calendar months. */
export function floorAnalyticsBucket(instant: string, bucket: AnalyticsBucket): Date {
  const date = new Date(instant)
  date.setUTCMilliseconds(0)
  date.setUTCSeconds(0)
  if (bucket === 'minute') return date
  date.setUTCMinutes(0)
  if (bucket === 'hour') return date
  date.setUTCHours(0)
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  if (bucket === 'month' || bucket === 'year') date.setUTCDate(1)
  if (bucket === 'year') date.setUTCMonth(0)
  return date
}

function advanceBucket(date: Date, bucket: AnalyticsBucket): void {
  switch (bucket) {
    case 'minute':
      date.setUTCMinutes(date.getUTCMinutes() + 1)
      break
    case 'hour':
      date.setUTCHours(date.getUTCHours() + 1)
      break
    case 'day':
      date.setUTCDate(date.getUTCDate() + 1)
      break
    case 'week':
      date.setUTCDate(date.getUTCDate() + 7)
      break
    case 'month':
      date.setUTCMonth(date.getUTCMonth() + 1)
      break
    case 'year':
      date.setUTCFullYear(date.getUTCFullYear() + 1)
      break
  }
}

export function fillAnalyticsBuckets(
  rows: Record<string, AnalyticsValue>[],
  query: AnalyticsQuery,
  bucket: AnalyticsBucket | null
): Record<string, AnalyticsValue>[] {
  const time = query.timeField ?? 'createdAt'
  if (
    !bucket ||
    query.groupBy?.length !== 1 ||
    query.limit !== undefined ||
    !query.aggregate ||
    query.sort?.some((sort) => sort.field !== time)
  )
    return rows
  const indexed = new Map(rows.map((row) => [row[time], row]))
  const result: Record<string, AnalyticsValue>[] = []
  const end = Date.parse(query.to)
  for (
    const date = floorAnalyticsBucket(query.from, bucket);
    date.getTime() < end;
    advanceBucket(date, bucket)
  ) {
    if (result.length >= ANALYTICS_MAX_ROWS)
      throw new OrchestrationError(
        'validation',
        'Too many time buckets. Increase the bucket or shorten the range.'
      )
    const key = date.toISOString()
    const existing = indexed.get(key)
    if (existing) result.push(existing)
    else
      result.push(
        Object.fromEntries([
          [time, key],
          ...Object.entries(query.aggregate).map(([alias, measure]) => [
            alias,
            measure.op === 'count' || measure.op === 'countDistinct' ? 0 : null,
          ]),
        ])
      )
  }
  return query.sort?.[0]?.direction === 'desc' ? result.reverse() : result
}
