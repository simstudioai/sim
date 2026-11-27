import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, avg, count, desc, eq, gte, notInArray, type SQL, sql } from 'drizzle-orm'
import { creditsToDollars } from '@/lib/billing/credits/conversion'
import {
  EVENTLESS_EXECUTION_TRIGGERS,
  SIM_MIN_EXECUTIONS_FOR_RATE_RULES,
  type SimRuleEventType,
} from '@/lib/workspace-events/constants'
import type { ExecutionEventContext, SimSubscriptionConfig } from '@/lib/workspace-events/types'

const logger = createLogger('WorkspaceEventRules')

/**
 * Excludes runs that count toward no rule from rule statistics: Sim-trigger side-effect runs, so
 * they never pollute failure/latency counts for workflows that are both source and subscriber,
 * and test runs, which are not the workflow's real traffic.
 */
export function excludeEventlessExecutionsCondition(): SQL {
  return notInArray(workflowExecutionLogs.trigger, [...EVENTLESS_EXECUTION_TRIGGERS])
}

async function checkConsecutiveFailures(workflowId: string, threshold: number): Promise<boolean> {
  const recentLogs = await db
    .select({ level: workflowExecutionLogs.level })
    .from(workflowExecutionLogs)
    .where(
      and(eq(workflowExecutionLogs.workflowId, workflowId), excludeEventlessExecutionsCondition())
    )
    .orderBy(desc(workflowExecutionLogs.startedAt))
    .limit(threshold)

  if (recentLogs.length < threshold) return false

  return recentLogs.every((log) => log.level === 'error')
}

/**
 * Fires when the in-window failure rate meets the threshold with at least
 * SIM_MIN_EXECUTIONS_FOR_RATE_RULES executions.
 *
 * Intentionally diverges from the legacy notification rule, which required
 * the oldest in-window log to predate the window start — a condition that is
 * false for every in-window log, making the legacy rule dead code.
 */
async function checkFailureRate(
  workflowId: string,
  ratePercent: number,
  windowHours: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  // Single DB-side aggregate: the window is user-configured and this runs on
  // the execution-completion path, so never materialize the in-window rows.
  const result = await db
    .select({
      total: count(),
      errors: count(sql`case when ${workflowExecutionLogs.level} = 'error' then 1 end`),
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.startedAt, windowStart),
        excludeEventlessExecutionsCondition()
      )
    )

  const total = result[0]?.total ?? 0
  if (total < SIM_MIN_EXECUTIONS_FOR_RATE_RULES) return false

  const errorCount = result[0]?.errors ?? 0
  const failureRate = (errorCount / total) * 100

  return failureRate >= ratePercent
}

async function checkLatencySpike(
  workflowId: string,
  currentDurationMs: number,
  spikePercent: number,
  windowHours: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const result = await db
    .select({
      avgDuration: avg(workflowExecutionLogs.totalDurationMs),
      count: count(),
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.startedAt, windowStart),
        excludeEventlessExecutionsCondition()
      )
    )

  const avgDuration = result[0]?.avgDuration
  const execCount = result[0]?.count || 0

  if (!avgDuration || execCount < SIM_MIN_EXECUTIONS_FOR_RATE_RULES) return false

  const avgMs = Number(avgDuration)
  const threshold = avgMs * (1 + spikePercent / 100)

  return currentDurationMs > threshold
}

async function checkErrorCount(
  workflowId: string,
  threshold: number,
  windowHours: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const result = await db
    .select({ count: count() })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        eq(workflowExecutionLogs.level, 'error'),
        gte(workflowExecutionLogs.startedAt, windowStart),
        excludeEventlessExecutionsCondition()
      )
    )

  const errorCount = result[0]?.count || 0
  return errorCount >= threshold
}

/**
 * Evaluates a rule-based event type against a completed execution.
 * `no_activity` always returns false here — it has no triggering execution
 * and is owned by the inactivity poller.
 */
export async function evaluateRule(
  eventType: SimRuleEventType,
  config: SimSubscriptionConfig,
  context: ExecutionEventContext
): Promise<boolean> {
  switch (eventType) {
    case 'consecutive_failures':
      if (context.status !== 'error') return false
      return checkConsecutiveFailures(context.workflowId, config.consecutiveFailures)

    case 'failure_rate':
      if (context.status !== 'error') return false
      return checkFailureRate(context.workflowId, config.failureRatePercent, config.windowHours)

    case 'latency_threshold':
      return context.durationMs > config.durationThresholdMs

    case 'latency_spike':
      return checkLatencySpike(
        context.workflowId,
        context.durationMs,
        config.latencySpikePercent,
        config.windowHours
      )

    case 'cost_threshold':
      // The threshold is credit-denominated (the UI unit); run costs are
      // stored in dollars, so convert the threshold for the comparison.
      return context.cost > creditsToDollars(config.costThresholdCredits)

    case 'error_count':
      if (context.status !== 'error') return false
      return checkErrorCount(context.workflowId, config.errorCountThreshold, config.windowHours)

    case 'no_activity':
      return false

    default:
      logger.warn(`Unknown sim trigger rule: ${eventType}`)
      return false
  }
}
