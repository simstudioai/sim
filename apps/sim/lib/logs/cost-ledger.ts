import { db } from '@sim/db'
import { usageLog } from '@sim/db/schema'
import { and, eq, notInArray } from 'drizzle-orm'
import type { CostLedger } from '@/lib/api/contracts/logs'
import { UNBILLED_USAGE_CATEGORIES } from '@/lib/billing/core/usage-log'

/**
 * The itemized billing lines for one run, or `null` when the run has no ledger.
 *
 * `null` and `[]` are different answers and both are reachable, so neither may
 * stand in for the other. `null` means `usage_log` recorded nothing for the
 * execution — a run that predates the ledger, or a job run, which the
 * `source = 'workflow'` predicate excludes outright. An empty array would claim
 * a ledger exists and itemizes to nothing.
 *
 * Lines are folded on `(category, description)` because the ledger records one
 * row per billed event and a run can bill the same model many times; token
 * counts take the maximum rather than the sum, matching how they are reported
 * per call rather than accumulated.
 *
 * Unbilled categories are excluded: this is what the run *cost*, so a BYOK model
 * — which Sim does not charge for — is not a line here. That usage is reported by
 * the organization usage panel instead.
 */
export async function buildCostLedger(executionId: string): Promise<CostLedger | null> {
  const rows = await db
    .select({
      category: usageLog.category,
      description: usageLog.description,
      cost: usageLog.cost,
      metadata: usageLog.metadata,
    })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.executionId, executionId),
        eq(usageLog.source, 'workflow'),
        notInArray(usageLog.category, [...UNBILLED_USAGE_CATEGORIES])
      )
    )

  if (rows.length === 0) return null

  type LedgerItem = CostLedger['items'][number]
  const byKey = new Map<string, LedgerItem>()
  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as { inputTokens?: number; outputTokens?: number }
    const category = row.category as LedgerItem['category']
    const key = `${category}::${row.description}`
    const existing = byKey.get(key)
    if (existing) {
      existing.cost += Number(row.cost)
      if (typeof metadata.inputTokens === 'number') {
        existing.inputTokens = Math.max(existing.inputTokens ?? 0, metadata.inputTokens)
      }
      if (typeof metadata.outputTokens === 'number') {
        existing.outputTokens = Math.max(existing.outputTokens ?? 0, metadata.outputTokens)
      }
    } else {
      byKey.set(key, {
        category,
        description: row.description,
        cost: Number(row.cost),
        ...(typeof metadata.inputTokens === 'number' ? { inputTokens: metadata.inputTokens } : {}),
        ...(typeof metadata.outputTokens === 'number'
          ? { outputTokens: metadata.outputTokens }
          : {}),
      })
    }
  }

  const items = [...byKey.values()]
  const total = items.reduce((sum, item) => sum + item.cost, 0)
  return { total, items }
}
