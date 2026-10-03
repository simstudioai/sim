import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import {
  readUsageEventCursor,
  writeUsageEventCursor,
} from '@/lib/billing/application/organization-usage/event-cursor'
import { requireBoundedUsageWindow } from '@/lib/billing/application/organization-usage/limits'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import {
  resolveUsageAnalyticsWindow,
  type UsageWindowPreset,
  usageWindowBounds,
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
  maxWindowDays?: number
  keyset?: { sortOrder: ListSortOrder; cursorKeys?: CursorKey[] }
}

export interface OrganizationUsageEvent {
  id: string
  createdAt: string
  source: InternalUsageLogSource
  description: string
  workflowName: string | null
  credits: number
  hasCost: boolean
}

export interface OrganizationUsageEventsResult {
  events: OrganizationUsageEvent[]
  nextCursor?: string
  nextCursorKeys?: CursorKey[] | null
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
    const resolveWindow = () =>
      resolveUsageAnalyticsWindow({
        preset: input.preset,
        period: context.period,
        customStart: input.startDate,
        customEnd: input.endDate,
        timezone: input.timezone,
      })
    const continuation = input.keyset?.cursorKeys
      ? readUsageEventCursor(
          input.keyset.cursorKeys,
          input.maxWindowDays,
          input.preset === 'custom' ? usageWindowBounds(resolveWindow()) : undefined
        )
      : undefined
    const window = continuation?.window ?? resolveWindow()
    requireBoundedUsageWindow(window, input.maxWindowDays)
    const result = await getBillingEntityUsageLogs(context.billingEntity, {
      // One derivation for both predicates, so this list covers exactly the rows the
      // summary and breakdowns aggregate over.
      ...usageWindowLedgerFilter(window),
      ...(input.source?.length ? { source: input.source } : {}),
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.keyset
        ? { keyset: { sortOrder: input.keyset.sortOrder, cursorKeys: continuation?.cursorKeys } }
        : {}),
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
      ...(input.keyset
        ? {
            nextCursorKeys: writeUsageEventCursor(window, result.pagination.nextCursorKeys ?? null),
          }
        : {}),
      hasMore: result.pagination.hasMore,
    }
  },
})
