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

/**
 * Circuit breaker, not a UX boundary. An enterprise ledger is genuinely large, so
 * hitting the cap truncates and says so rather than failing the download.
 */
export const USAGE_EXPORT_SAFETY_CAP = 100_000
const EXPORT_PAGE_SIZE = 1000

export interface OrganizationUsageExportInput {
  organizationId: string
  preset: UsageWindowPreset
  startDate?: Date
  endDate?: Date
  /** Viewer calendar, so a date-only custom bound means midnight there. */
  timezone?: string
  source?: InternalUsageLogSource[]
}

export interface OrganizationUsageExportRow {
  createdAt: string
  source: string
  description: string
  workflowName: string | null
  credits: number
}

export interface OrganizationUsageExportResult {
  rows: OrganizationUsageExportRow[]
  truncated: boolean
}

/**
 * Every event in the window, paged to the cap.
 *
 * Returns data, not CSV: serialization is presentation and belongs in the route, so
 * this module stays free of any HTTP concern.
 */
export const exportOrganizationUsageEvents = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.exportEvents,
  organizationId: (input: OrganizationUsageExportInput) => input.organizationId,
  async execute({ input, context }): Promise<OrganizationUsageExportResult> {
    const window = resolveUsageAnalyticsWindow({
      preset: input.preset,
      period: context.period,
      customStart: input.startDate,
      customEnd: input.endDate,
      timezone: input.timezone,
    })
    const ledgerFilter = usageWindowLedgerFilter(window)

    const rows: OrganizationUsageExportRow[] = []
    let cursor: string | undefined
    let truncated = false

    while (rows.length < USAGE_EXPORT_SAFETY_CAP) {
      const page = await getBillingEntityUsageLogs(context.billingEntity, {
        // One derivation for both predicates, so the CSV covers exactly the rows the
        // summary and breakdowns aggregate over.
        ...ledgerFilter,
        ...(input.source?.length ? { source: input.source } : {}),
        limit: EXPORT_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        // Each page would otherwise repeat the same cursor-independent aggregate
        // for a total this export never reads.
        includeSummary: false,
      })

      for (const log of page.logs) {
        rows.push({
          createdAt: log.createdAt,
          source: log.source,
          description: log.description,
          workflowName: log.workflowName ?? null,
          credits: dollarsToCredits(log.cost),
        })
      }

      if (!page.pagination.hasMore || !page.pagination.nextCursor) break
      cursor = page.pagination.nextCursor
      if (rows.length >= USAGE_EXPORT_SAFETY_CAP) {
        truncated = true
        break
      }
    }

    return { rows: rows.slice(0, USAGE_EXPORT_SAFETY_CAP), truncated }
  },
})
