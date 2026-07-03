import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'
import type { UsageLogPeriod } from '@/lib/api/contracts/user'
import type { UsageLogSource } from '@/lib/billing/core/usage-log'

const PERIOD_TO_DAYS: Record<'1d' | '7d' | '30d', number> = { '1d': 1, '7d': 7, '30d': 30 }

interface ResolvedDateRange {
  startDate: Date | undefined
  endDate: Date
}

/** Shared by the list and export routes so their date-filtering can never drift. */
export function resolveDateRange(
  period: UsageLogPeriod,
  customStartDate: string | undefined,
  customEndDate: string | undefined
): ResolvedDateRange {
  if (period === 'custom') {
    // Contract-enforced: startDate is required whenever period is 'custom'.
    return {
      startDate: new Date(customStartDate as string),
      endDate: customEndDate ? new Date(customEndDate) : new Date(),
    }
  }
  if (period === 'all') return { startDate: undefined, endDate: new Date() }

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - PERIOD_TO_DAYS[period])
  return { startDate, endDate: new Date() }
}

/**
 * Looks up workflow names for the distinct `workflowId`s among workflow-sourced
 * logs, so rows can show "Workflow: {name}" instead of the generic source label.
 * Shared by the list and export routes.
 */
export async function resolveWorkflowNames(
  logs: { source: UsageLogSource; workflowId?: string }[]
): Promise<Map<string, string>> {
  const workflowIds = [
    ...new Set(
      logs
        .filter((log) => log.source === 'workflow' && log.workflowId)
        .map((log) => log.workflowId as string)
    ),
  ]
  if (workflowIds.length === 0) return new Map()

  const rows = await db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(inArray(workflow.id, workflowIds))

  return new Map(rows.map((row) => [row.id, row.name]))
}
