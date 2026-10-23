import { db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { and, eq, sql } from 'drizzle-orm'
import type { UsageUpgradePayload } from '@/lib/api/contracts/subscription'

/** The spend cap of one job run when its schedule names none, in USD. */
const DEFAULT_JOB_RUN_BUDGET_USD = 5

/** A schedule's per-run cap, or the default when it names none. */
export function jobRunBudgetUsd(runBudgetUsd: string | null): number {
  const budget = runBudgetUsd === null ? Number.NaN : Number(runBudgetUsd)
  return Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_JOB_RUN_BUDGET_USD
}

/**
 * Records a job run's settled cost from a billing callback and reports whether the run has
 * reached its own cap. The callback's cost is cumulative for the run's billing request, which
 * every leg of the run reuses (a recovered leg restores the original admission), so the cap
 * holds across worker hand-offs and Sim takeovers. A request that is not a job run's matches no
 * record and answers null, so ordinary chats pay one index probe.
 */
export async function recordJobRunSpend(
  billingRequestId: string,
  cumulativeCostUsd: number
): Promise<UsageUpgradePayload | null> {
  const [run] = await db
    .update(jobExecutionLogs)
    .set({
      cost: sql`jsonb_build_object('total', GREATEST(COALESCE((${jobExecutionLogs.cost}->>'total')::numeric, 0), ${cumulativeCostUsd}::numeric))`,
    })
    .where(eq(jobExecutionLogs.billingRequestId, billingRequestId))
    .returning({
      scheduleId: jobExecutionLogs.scheduleId,
      total: sql<string>`${jobExecutionLogs.cost}->>'total'`,
    })
  if (!run?.scheduleId) return null
  const [schedule] = await db
    .select({ runBudgetUsd: workflowSchedule.runBudgetUsd })
    .from(workflowSchedule)
    .where(and(eq(workflowSchedule.id, run.scheduleId), eq(workflowSchedule.sourceType, 'job')))
    .limit(1)
  if (!schedule) return null
  const budget = jobRunBudgetUsd(schedule.runBudgetUsd)
  if (Number(run.total) < budget) return null
  return {
    reason: 'job_run_budget',
    action: 'increase_limit',
    message: `This scheduled job run reached its $${budget.toFixed(2)} spend limit, so it stopped here. The next run starts with a fresh limit.`,
  }
}
