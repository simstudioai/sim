import {
  type ActivityMetrics,
  type ActivityStretch,
  activityMetrics,
  combineActivity,
} from '@/lib/billing/core/organization-activity'
import { truncateToBucket, type UsageBucket } from '@/lib/billing/core/usage-analytics'

export interface ActivitySeriesPoint {
  timestamp: string
  workflowRuns: number
  completed: number
  failed: number
  chatRuns: number
}

/**
 * Folds calendar days into the window's buckets and its totals.
 *
 * `timestamps` are the window's buckets, including empty ones, so every bucket is
 * drawn. Members are unioned rather than summed and durations are weighted by run,
 * so a total over many days is the same figure one query over the window would give.
 */
export function summarizeActivityDays(
  days: Iterable<[string, ActivityStretch]>,
  timestamps: string[],
  bucket: UsageBucket
): { totals: ActivityMetrics; series: ActivitySeriesPoint[] } {
  const series = timestamps.map((timestamp) => ({
    timestamp,
    workflowRuns: 0,
    completed: 0,
    failed: 0,
    chatRuns: 0,
  }))
  const byBucket = new Map(series.map((point) => [point.timestamp.slice(0, 10), point]))
  const stretches: ActivityStretch[] = []

  for (const [day, activity] of days) {
    stretches.push(activity)
    const point = byBucket.get(truncateToBucket(day, bucket))
    if (point) {
      point.workflowRuns += activity.workflowRuns
      point.completed += activity.completed
      point.failed += activity.failed
      point.chatRuns += activity.chatRuns
    }
  }
  const total = combineActivity(stretches)

  return {
    totals: activityMetrics({
      ...total,
      chatMembers: total.chatMembers.length,
      averageDurationMs: total.durationCount > 0 ? total.durationSum / total.durationCount : null,
    }),
    series,
  }
}
