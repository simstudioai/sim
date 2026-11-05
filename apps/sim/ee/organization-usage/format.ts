import type {
  OrganizationUsageBreakdown,
  OrganizationUsageEvent,
  OrganizationUsageOverview,
} from '@/lib/api/contracts/organization-usage'
import {
  BILLING_USAGE_LOG_SOURCE_LABELS,
  type InternalUsageLogSource,
  toBillingUsageLogSource,
} from '@/lib/billing/usage-sources'
import {
  USAGE_SOURCE_CATEGORIES,
  USAGE_SOURCE_CATEGORY,
  type UsageSourceCategoryId,
} from '@/ee/organization-usage/constants'

type UsageSourceCategory = (typeof USAGE_SOURCE_CATEGORIES)[number]

/**
 * Folds per-source cells into the chart's fixed categories, in layer order. Only categories with
 * usage appear, and each keeps its own color, so a quiet period never repaints the survivors.
 */
export function foldUsageSeries(
  series: OrganizationUsageOverview['series']
): { category: UsageSourceCategory; values: number[] }[] {
  const byCategory = new Map<UsageSourceCategoryId, number[]>()
  series.forEach((point, index) => {
    for (const [source, credits] of Object.entries(point.sources)) {
      const category = USAGE_SOURCE_CATEGORY[source as keyof typeof USAGE_SOURCE_CATEGORY]
      let values = byCategory.get(category)
      if (!values) {
        values = new Array<number>(series.length).fill(0)
        byCategory.set(category, values)
      }
      values[index] += credits ?? 0
    }
  })
  return USAGE_SOURCE_CATEGORIES.flatMap((category) => {
    const values = byCategory.get(category.id)
    return values ? [{ category, values }] : []
  })
}

/**
 * The head of a ranking, with the rest folded into its remainder.
 *
 * The card reads the Models tab's own query and trims it here rather than asking the
 * server for fewer rows: the ledger scan costs the same either way, and sharing the
 * key means "View all" opens from cache.
 */
export function truncateBreakdown(
  breakdown: OrganizationUsageBreakdown,
  count: number
): OrganizationUsageBreakdown {
  const hidden = breakdown.rows.slice(count)
  return {
    ...breakdown,
    rows: breakdown.rows.slice(0, count),
    other: {
      credits: breakdown.other.credits + hidden.reduce((sum, row) => sum + row.credits, 0),
      events: breakdown.other.events + hidden.reduce((sum, row) => sum + row.events, 0),
      rowCount: breakdown.other.rowCount + hidden.length,
      tokens: breakdown.other.tokens + hidden.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    },
  }
}

export function formatFailureRate(rate: number | null): string {
  return rate === null
    ? '—'
    : new Intl.NumberFormat(undefined, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(rate)
}

/** A workflow row names its workflow; everything else reads as its product surface. */
export function usageEventLabel(event: OrganizationUsageEvent): string {
  if (event.source === 'workflow' && event.workflowName) return `Workflow: ${event.workflowName}`
  return BILLING_USAGE_LOG_SOURCE_LABELS[
    toBillingUsageLogSource(event.source as InternalUsageLogSource)
  ]
}
