import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import type { UsagePeriodSource } from '@/lib/billing/core/reporting-period'
import {
  buildUsageAnalyticsScope,
  densifyUsageSeries,
  resolvePreviousPeriod,
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  type UsageBucket,
  type UsageWindowPreset,
  usageWindowBounds,
} from '@/lib/billing/core/usage-analytics'
import { readUsageTimeSeries, readUsageTotals } from '@/lib/billing/core/usage-analytics-queries'
import { apportionCredits, dollarsToCredits } from '@/lib/billing/credits/conversion'

export interface OrganizationUsageSummaryInput {
  organizationId: string
  preset: UsageWindowPreset
  startDate?: Date
  endDate?: Date
  timezone: string
}

export interface OrganizationUsageSummaryResult {
  window: { start: string; end: string; source: UsagePeriodSource | 'range' }
  bucket: UsageBucket
  totals: { credits: number }
  previousTotals: { credits: number } | null
  series: Array<{ timestamp: string; credits: number; events: number }>
}

/**
 * Everything above the fold in one round trip: headline totals, the delta, and the
 * trend series. Every read here is index-covered, so this is cheap enough to be what
 * first paint waits on — the breakdowns, which are not, are fetched separately.
 */
export const getOrganizationUsageSummary = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readSummary,
  organizationId: (input: OrganizationUsageSummaryInput) => input.organizationId,
  async execute({ input, context }): Promise<OrganizationUsageSummaryResult> {
    const window = resolveUsageAnalyticsWindow({
      preset: input.preset,
      period: context.period,
      customStart: input.startDate,
      customEnd: input.endDate,
      timezone: input.timezone,
    })
    const bucket = resolveUsageBucket(window)
    const scope = buildUsageAnalyticsScope(context.billingEntity, window)

    /**
     * The comparison window only exists when it is exactly derivable.
     *
     * `resolvePreviousPeriod` directly, not the `previous-period` preset: that preset
     * must always return *something*, because a user who explicitly asks for the
     * previous period has to see a window — so for a stripe period it approximates one
     * by stepping back the current period's length. That approximation is fine as a
     * destination and wrong as a baseline, since Stripe periods are not equal-length
     * and the delta would silently compare against a window that is not the previous
     * period. No delta beats a delta measured against the wrong window.
     */
    const previousPeriod =
      input.preset === 'current-period' ? resolvePreviousPeriod(context.period) : null
    const comparison = previousPeriod ? { kind: 'period' as const, period: previousPeriod } : null

    const [totals, seriesRows, previous] = await Promise.all([
      readUsageTotals(scope),
      readUsageTimeSeries(scope, bucket, input.timezone),
      comparison
        ? readUsageTotals(buildUsageAnalyticsScope(context.billingEntity, comparison))
        : Promise.resolve(null),
    ])

    const bounds = usageWindowBounds(window)
    /**
     * One apportionment across the buckets, not a per-bucket round.
     *
     * A day costing less than half a credit rounds to zero on its own, so an
     * organization spending a fraction of a credit a day drew a flat empty chart under
     * a positive headline — the reader's conclusion being that the chart is broken.
     * Largest-remainder distributes the period's rounded total across its buckets, so
     * the bars sum to the headline and a nonzero day is never drawn as zero.
     *
     * Same routine, and the same reasoning, as the breakdown's rows-plus-remainder.
     */
    const densified = densifyUsageSeries(seriesRows, window, bucket, input.timezone)
    const apportioned = apportionCredits(
      densified.map((point, index) => ({ key: `b:${index}` as const, dollars: point.cost }))
    )
    const bucketCredits = densified.map((point, index) => ({
      timestamp: point.timestamp,
      credits: apportioned[`b:${index}`] ?? 0,
      events: point.events,
    }))

    return {
      window: {
        start: bounds.start.toISOString(),
        end: bounds.end.toISOString(),
        source: window.kind === 'range' ? 'range' : window.period.source,
      },
      bucket,
      totals: { credits: dollarsToCredits(totals.cost) },
      previousTotals: previous ? { credits: dollarsToCredits(previous.cost) } : null,
      series: bucketCredits.map((point) => ({
        timestamp: point.timestamp,
        credits: point.credits,
        events: point.events,
      })),
    }
  },
})
