import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import type { UsagePeriodSource } from '@/lib/billing/core/reporting-period'
import {
  buildUsageAnalyticsScope,
  densifyUsageSeries,
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  type UsageBucket,
  type UsageWindowPreset,
  usageWindowBounds,
} from '@/lib/billing/core/usage-analytics'
import { readUsageTimeSeries, readUsageTotals } from '@/lib/billing/core/usage-analytics-queries'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'

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
    })
    const bucket = resolveUsageBucket(window)
    const scope = buildUsageAnalyticsScope(context.billingEntity, window)

    /**
     * The comparison window only exists when it is exactly derivable. A stripe period
     * has no rule for its predecessor, and no delta beats a delta measured against the
     * wrong window.
     */
    const comparison =
      input.preset === 'current-period'
        ? resolveUsageAnalyticsWindow({ preset: 'previous-period', period: context.period })
        : null

    const [totals, seriesRows, previous] = await Promise.all([
      readUsageTotals(scope),
      readUsageTimeSeries(scope, bucket, input.timezone),
      comparison
        ? readUsageTotals(buildUsageAnalyticsScope(context.billingEntity, comparison))
        : Promise.resolve(null),
    ])

    const bounds = usageWindowBounds(window)
    return {
      window: {
        start: bounds.start.toISOString(),
        end: bounds.end.toISOString(),
        source: window.kind === 'range' ? 'range' : window.period.source,
      },
      bucket,
      totals: { credits: dollarsToCredits(totals.cost) },
      previousTotals: previous ? { credits: dollarsToCredits(previous.cost) } : null,
      // Same timezone the query grouped by, or the series keys cannot match its rows.
      series: densifyUsageSeries(seriesRows, window, bucket, input.timezone).map((point) => ({
        timestamp: point.timestamp,
        credits: dollarsToCredits(point.cost),
        events: point.events,
      })),
    }
  },
})
