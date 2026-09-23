import { dbReplica } from '@sim/db'
import { ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT } from '@/lib/api/contracts/organization-usage'
import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import {
  buildUsageBreakdown,
  type OrganizationUsageBreakdownResult,
} from '@/lib/billing/application/organization-usage/get-organization-usage-breakdown'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import type { UsagePeriodSource } from '@/lib/billing/core/reporting-period'
import { getOrgUsageLimit } from '@/lib/billing/core/usage'
import {
  resolveComparisonWindow,
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  truncateToBucket,
  type UsageBucket,
  type UsageWindowPreset,
  usageBucketTimestamps,
  usageWindowBounds,
} from '@/lib/billing/core/usage-analytics'
import { readUsageDays, readUsageMemberProfiles } from '@/lib/billing/core/usage-analytics-queries'
import { apportionCredits, dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  type BillingUsageLogSource,
  type InternalUsageLogSource,
  toBillingUsageLogSource,
} from '@/lib/billing/usage-sources'

export interface OrganizationUsageOverviewInput {
  organizationId: string
  preset: UsageWindowPreset
  startDate?: Date
  endDate?: Date
  timezone: string
  /** Narrows to one workspace, for the Workspaces drill-down. */
  workspaceId?: string
}

export interface OrganizationUsageOverviewResult {
  window: { start: string; end: string; source: UsagePeriodSource | 'range' }
  bucket: UsageBucket
  totals: { credits: number }
  previousTotals: { credits: number } | null
  limitCredits: number | null
  series: Array<{
    timestamp: string
    credits: number
    sources: Partial<Record<BillingUsageLogSource, number>>
  }>
  members: OrganizationUsageBreakdownResult & {
    rows: Array<OrganizationUsageBreakdownResult['rows'][number] & { image: string | null }>
  }
}

/**
 * Everything the Insights overview draws.
 *
 * Read through the usage segment cache (see `readUsageDays`): a settled day or hour is
 * scanned once and served from the cache after, so a large organization pays for its
 * whole window only on the first view, and afterwards only for its unsettled hours.
 *
 * The headline and every bar are sums of the same apportioned cells, so they
 * reconcile to the credit by construction; the member card is the Members tab's own
 * ranking, cut to its first rows.
 */
export const getOrganizationUsageOverview = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readOverview,
  organizationId: (input: OrganizationUsageOverviewInput) => input.organizationId,
  async execute({ input, context }): Promise<OrganizationUsageOverviewResult> {
    const window = resolveUsageAnalyticsWindow({
      preset: input.preset,
      period: context.period,
      customStart: input.startDate,
      customEnd: input.endDate,
      timezone: input.timezone,
    })
    const bucket = resolveUsageBucket(window)
    const read = {
      entity: context.billingEntity,
      timezone: input.timezone,
      workspaceId: input.workspaceId,
    }
    const comparison = resolveComparisonWindow(input.preset, window, context.period)
    /** The allowance only means something for the whole organization over its own period. */
    const subscription =
      input.preset === 'current-period' && !input.workspaceId ? context.subscription : null

    const [sourceDays, previousDays, members, limit] = await Promise.all([
      readUsageDays({ ...read, window, dimension: 'source' }),
      comparison
        ? readUsageDays({ ...read, window: comparison, dimension: 'source' })
        : Promise.resolve(null),
      buildUsageBreakdown({
        ...read,
        window,
        dimension: 'member',
        limit: ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT,
      }).then(async (breakdown) => {
        const profiles = await readUsageMemberProfiles(breakdown.rows.map((row) => row.id))
        return {
          ...breakdown,
          rows: breakdown.rows.map((row) => ({
            ...row,
            image: profiles.get(row.id)?.image ?? null,
          })),
        }
      }),
      subscription
        ? getOrgUsageLimit(
            input.organizationId,
            subscription.plan,
            subscription.seats ?? null,
            dbReplica
          )
        : Promise.resolve(null),
    ])

    const timestamps = usageBucketTimestamps(window, bucket, input.timezone)
    const bucketIndex = new Map(
      timestamps.map((timestamp, index) => [timestamp.slice(0, 10), index])
    )

    /**
     * Re-keyed onto the displayed source and bucket before apportioning: the ledger's
     * `copilot` and `workspace-chat` both display as Sim Chat, and a week's bars sum
     * its days, so rounding the finer cells separately could leave a displayed cell a
     * credit off its own dollars.
     */
    const cells: { index: number; source: BillingUsageLogSource; dollars: number }[] = []
    const cellFor = new Map<string, (typeof cells)[number]>()
    for (const [day, rows] of sourceDays) {
      const index = bucketIndex.get(truncateToBucket(day, bucket))
      if (index === undefined) continue
      for (const row of rows) {
        if (!row.key) continue
        const source = toBillingUsageLogSource(row.key as InternalUsageLogSource)
        const identity = `${index}:${source}`
        const cell = cellFor.get(identity)
        if (cell) cell.dollars += row.cost
        else {
          const created = { index, source, dollars: row.cost }
          cells.push(created)
          cellFor.set(identity, created)
        }
      }
    }
    const cellCredits = apportionCredits(
      cells.map((cell, position) => ({ key: String(position), dollars: cell.dollars }))
    )

    const series: OrganizationUsageOverviewResult['series'] = timestamps.map((timestamp) => ({
      timestamp,
      credits: 0,
      sources: {},
    }))
    cells.forEach((cell, position) => {
      const credits = cellCredits[String(position)] ?? 0
      if (credits <= 0) return
      const point = series[cell.index]
      point.credits += credits
      point.sources[cell.source] = credits
    })

    const bounds = usageWindowBounds(window)
    return {
      window: {
        start: bounds.start.toISOString(),
        end: bounds.end.toISOString(),
        source: window.kind === 'range' ? 'range' : window.period.source,
      },
      bucket,
      totals: { credits: series.reduce((sum, point) => sum + point.credits, 0) },
      previousTotals: previousDays
        ? {
            credits: dollarsToCredits(
              previousDays.flatMap(([, rows]) => rows).reduce((sum, row) => sum + row.cost, 0)
            ),
          }
        : null,
      limitCredits: limit && limit.limit > 0 ? dollarsToCredits(limit.limit) : null,
      series,
      members,
    }
  },
})
