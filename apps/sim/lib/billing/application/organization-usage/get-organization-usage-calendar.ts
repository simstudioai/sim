import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import {
  resolveUsageCalendarWindow,
  usageBucketTimestamps,
} from '@/lib/billing/core/usage-analytics'
import { readUsageDays } from '@/lib/billing/core/usage-analytics-queries'
import { apportionCredits } from '@/lib/billing/credits/conversion'

interface OrganizationUsageCalendarInput {
  organizationId: string
  timezone: string
  workspaceId?: string
}

/** Daily credits for a bounded year, independent of the dashboard's selected period. */
export const getOrganizationUsageCalendar = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readCalendar,
  organizationId: (input: OrganizationUsageCalendarInput) => input.organizationId,
  async execute({ input, context }) {
    const window = resolveUsageCalendarWindow(input.timezone)
    const days = usageBucketTimestamps(window, 'day', input.timezone).map((timestamp) =>
      timestamp.slice(0, 10)
    )
    const dollars = new Map(days.map((day) => [day, 0]))
    const segments = await readUsageDays({
      entity: context.billingEntity,
      window,
      timezone: input.timezone,
      workspaceId: input.workspaceId,
      dimension: 'source',
    })
    for (const [day, rows] of segments) {
      const current = dollars.get(day)
      if (current === undefined) continue
      dollars.set(day, current + rows.reduce((sum, row) => sum + row.cost, 0))
    }
    const credits = apportionCredits(
      days.map((day) => ({ key: day, dollars: dollars.get(day) ?? 0 }))
    )
    return {
      days: days.map((date) => ({
        date,
        credits: credits[date] ?? 0,
        hasCost: (dollars.get(date) ?? 0) > 0,
      })),
    }
  },
})
