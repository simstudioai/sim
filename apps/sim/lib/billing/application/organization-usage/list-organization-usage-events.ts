import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import {
  resolveUsageAnalyticsWindow,
  type UsageWindowPreset,
  usageWindowLedgerFilter,
} from '@/lib/billing/core/usage-analytics'
import { getBillingEntityUsageLogs } from '@/lib/billing/core/usage-log'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import type { InternalUsageLogSource } from '@/lib/billing/usage-sources'

export interface OrganizationUsageEventsInput {
  organizationId: string
  preset: UsageWindowPreset
  startDate?: Date
  endDate?: Date
  /** Viewer calendar, so a date-only custom bound means midnight there. */
  timezone?: string
  source?: InternalUsageLogSource[]
  limit: number
  cursor?: string
}

export interface OrganizationUsageEvent {
  id: string
  createdAt: string
  source: string
  description: string
  workflowName: string | null
  credits: number
  hasCost: boolean
}

export interface OrganizationUsageEventsResult {
  events: OrganizationUsageEvent[]
  nextCursor?: string
  hasMore: boolean
}

/**
 * One page of the organization's raw ledger.
 *
 * Reuses `getBillingEntityUsageLogs` rather than rebuilding pagination: keyset
 * ordering, cursor resolution, and the workflow-name join are already correct there.
 * `includeSummary` stays off because the page header reads its total from the summary
 * endpoint — recomputing the full-filter aggregate on every scroll would pay for the
 * same scan once per page.
 */
export const listOrganizationUsageEvents = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.listEvents,
  organizationId: (input: OrganizationUsageEventsInput) => input.organizationId,
  async execute({ input, context }): Promise<OrganizationUsageEventsResult> {
    const window = resolveUsageAnalyticsWindow({
      preset: input.preset,
      period: context.period,
      customStart: input.startDate,
      customEnd: input.endDate,
      timezone: input.timezone,
    })
    const result = await getBillingEntityUsageLogs(context.billingEntity, {
      // One derivation for both predicates, so this list covers exactly the rows the
      // summary and breakdowns aggregate over.
      ...usageWindowLedgerFilter(window),
      ...(input.source?.length ? { source: input.source } : {}),
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      includeSummary: false,
    })

    return {
      events: result.logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt,
        source: log.source,
        description: log.description,
        workflowName: log.workflowName ?? null,
        credits: dollarsToCredits(log.cost),
        hasCost: log.cost > 0,
      })),
      ...(result.pagination.nextCursor ? { nextCursor: result.pagination.nextCursor } : {}),
      hasMore: result.pagination.hasMore,
    }
  },
})
