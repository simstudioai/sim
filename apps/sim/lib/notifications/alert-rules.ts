import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, avg, count, desc, eq, gte, inArray } from 'drizzle-orm'

const logger = createLogger('AlertRules')

/**
 * Alert rule types supported by the notification system
 */
export type AlertRuleType =
  | 'consecutive_failures'
  | 'failure_rate'
  | 'latency_threshold'
  | 'latency_spike'
  | 'cost_threshold'
  | 'no_activity'
  | 'error_count'

/**
 * Configuration for alert rules
 */
export interface AlertConfig {
  rule: AlertRuleType
  consecutiveFailures?: number
  failureRatePercent?: number
  windowHours?: number
  durationThresholdMs?: number
  latencySpikePercent?: number
  costThresholdDollars?: number
  inactivityHours?: number
  errorCountThreshold?: number
}

/**
 * Metadata for alert rule types
 */
export interface AlertRuleDefinition {
  type: AlertRuleType
  name: string
  description: string
  requiredFields: (keyof AlertConfig)[]
  defaultValues: Partial<AlertConfig>
}

/**
 * Registry of all alert rule definitions
 */
export const ALERT_RULES: Record<AlertRuleType, AlertRuleDefinition> = {
  consecutive_failures: {
    type: 'consecutive_failures',
    name: 'Consecutive Failures',
    description: 'Alert after X consecutive failed executions',
    requiredFields: ['consecutiveFailures'],
    defaultValues: { consecutiveFailures: 3 },
  },
  failure_rate: {
    type: 'failure_rate',
    name: 'Failure Rate',
    description: 'Alert when failure rate exceeds X% over a time window',
    requiredFields: ['failureRatePercent', 'windowHours'],
    defaultValues: { failureRatePercent: 50, windowHours: 24 },
  },
  latency_threshold: {
    type: 'latency_threshold',
    name: 'Latency Threshold',
    description: 'Alert when execution duration exceeds a threshold',
    requiredFields: ['durationThresholdMs'],
    defaultValues: { durationThresholdMs: 30000 },
  },
  latency_spike: {
    type: 'latency_spike',
    name: 'Latency Spike',
    description: 'Alert when execution is X% slower than average',
    requiredFields: ['latencySpikePercent', 'windowHours'],
    defaultValues: { latencySpikePercent: 100, windowHours: 24 },
  },
  cost_threshold: {
    type: 'cost_threshold',
    name: 'Cost Threshold',
    description: 'Alert when execution cost exceeds a threshold',
    requiredFields: ['costThresholdDollars'],
    defaultValues: { costThresholdDollars: 1 },
  },
  no_activity: {
    type: 'no_activity',
    name: 'No Activity',
    description: 'Alert when no executions occur within a time window',
    requiredFields: ['inactivityHours'],
    defaultValues: { inactivityHours: 24 },
  },
  error_count: {
    type: 'error_count',
    name: 'Error Count',
    description: 'Alert when error count exceeds threshold within time window',
    requiredFields: ['errorCountThreshold', 'windowHours'],
    defaultValues: { errorCountThreshold: 10, windowHours: 1 },
  },
}

/**
 * Cooldown period in hours to prevent alert spam
 */
export const ALERT_COOLDOWN_HOURS = 1

/**
 * Minimum executions required for rate-based alerts
 */
export const MIN_EXECUTIONS_FOR_RATE_ALERT = 5

/**
 * Validates an alert configuration
 */
export function validateAlertConfig(config: AlertConfig): { valid: boolean; error?: string } {
  const definition = ALERT_RULES[config.rule]
  if (!definition) {
    return { valid: false, error: `Unknown alert rule: ${config.rule}` }
  }

  for (const field of definition.requiredFields) {
    if (config[field] === undefined || config[field] === null) {
      return { valid: false, error: `Missing required field: ${field}` }
    }
  }

  return { valid: true }
}

/**
 * Checks if a subscription is within its cooldown period
 */
export function isInCooldown(lastAlertAt: Date | null): boolean {
  if (!lastAlertAt) return false
  const cooldownEnd = new Date(lastAlertAt.getTime() + ALERT_COOLDOWN_HOURS * 60 * 60 * 1000)
  return new Date() < cooldownEnd
}

export interface AlertCheckContext {
  workflowId: string
  executionId: string
  status: 'success' | 'error'
  durationMs: number
  cost: number
  triggerFilter: string[]
}

async function checkConsecutiveFailures(
  workflowId: string,
  threshold: number,
  triggerFilter: string[]
): Promise<boolean> {
  const recentLogs = await db
    .select({ level: workflowExecutionLogs.level })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        inArray(workflowExecutionLogs.trigger, triggerFilter)
      )
    )
    .orderBy(desc(workflowExecutionLogs.createdAt))
    .limit(threshold)

  if (recentLogs.length < threshold) return false

  return recentLogs.every((log) => log.level === 'error')
}

async function checkFailureRate(
  workflowId: string,
  ratePercent: number,
  windowHours: number,
  triggerFilter: string[]
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const logs = await db
    .select({
      level: workflowExecutionLogs.level,
      createdAt: workflowExecutionLogs.createdAt,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        gte(workflowExecutionLogs.createdAt, windowStart),
        inArray(workflowExecutionLogs.trigger, triggerFilter)
      )
    )
    .orderBy(workflowExecutionLogs.createdAt)

  if (logs.length < MIN_EXECUTIONS_FOR_RATE_ALERT) return false

  const oldestLog = logs[0]
  if (oldestLog && oldestLog.createdAt > windowStart) {
    return false
  }

  const errorCount = logs.filter((log) => log.level === 'error').length
  const failureRate = (errorCount / logs.length) * 100

  return failureRate >= ratePercent
}

/**
 * Check if execution duration exceeds threshold
 */
function checkLatencyThreshold(durationMs: number, thresholdMs: number): boolean {
  return durationMs > thresholdMs
}

async function checkLatencySpike(
  workflowId: string,
  currentDurationMs: number,
  spikePercent: number,
  windowHours: number,
  triggerFilter: string[]
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
        gte(workflowExecutionLogs.createdAt, windowStart),
        inArray(workflowExecutionLogs.trigger, triggerFilter)
      )
    )

  const avgDuration = result[0]?.avgDuration
  const execCount = result[0]?.count || 0

  if (!avgDuration || execCount < MIN_EXECUTIONS_FOR_RATE_ALERT) return false

  const avgMs = Number(avgDuration)
  const threshold = avgMs * (1 + spikePercent / 100)

  return currentDurationMs > threshold
}

/**
 * Check if execution cost exceeds threshold
 */
function checkCostThreshold(cost: number, thresholdDollars: number): boolean {
  return cost > thresholdDollars
}

async function checkErrorCount(
  workflowId: string,
  threshold: number,
  windowHours: number,
  triggerFilter: string[]
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const result = await db
    .select({ count: count() })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, workflowId),
        eq(workflowExecutionLogs.level, 'error'),
        gte(workflowExecutionLogs.createdAt, windowStart),
        inArray(workflowExecutionLogs.trigger, triggerFilter)
      )
    )

  const errorCount = result[0]?.count || 0
  return errorCount >= threshold
}

export async function shouldTriggerAlert(
  config: AlertConfig,
  context: AlertCheckContext,
  lastAlertAt: Date | null
): Promise<boolean> {
  if (isInCooldown(lastAlertAt)) {
    logger.debug('Subscription in cooldown, skipping alert check')
    return false
  }

  const { rule } = config
  const { workflowId, status, durationMs, cost, triggerFilter } = context

  switch (rule) {
    case 'consecutive_failures':
      if (status !== 'error') return false
      return checkConsecutiveFailures(workflowId, config.consecutiveFailures!, triggerFilter)

    case 'failure_rate':
      if (status !== 'error') return false
      return checkFailureRate(
        workflowId,
        config.failureRatePercent!,
        config.windowHours!,
        triggerFilter
      )

    case 'latency_threshold':
      return checkLatencyThreshold(durationMs, config.durationThresholdMs!)

    case 'latency_spike':
      return checkLatencySpike(
        workflowId,
        durationMs,
        config.latencySpikePercent!,
        config.windowHours!,
        triggerFilter
      )

    case 'cost_threshold':
      return checkCostThreshold(cost, config.costThresholdDollars!)

    case 'no_activity':
      return false

    case 'error_count':
      if (status !== 'error') return false
      return checkErrorCount(
        workflowId,
        config.errorCountThreshold!,
        config.windowHours!,
        triggerFilter
      )

    default:
      logger.warn(`Unknown alert rule: ${rule}`)
      return false
  }
}
