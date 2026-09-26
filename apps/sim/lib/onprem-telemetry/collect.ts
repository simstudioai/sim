import { dbReplica } from '@sim/db'
import { usageLog, workflowExecutionLogs } from '@sim/db/schema'
import { and, gte, lt, sql } from 'drizzle-orm'
import type {
  OnPremUsageBucket,
  OnPremUsageModelLine,
  OnPremUsageSourceLine,
} from '@/lib/api/contracts/onprem-telemetry'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
import type { DbClient } from '@/lib/db/types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Model categories whose `description` is a model name and whose metadata carries tokens. */
const MODEL_CATEGORIES = new Set(['model', 'model_unbilled'])

/** Start of the UTC calendar day containing `at`. */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
}

/** `YYYY-MM-DD` of the UTC day containing `at`; the grouping key the queries emit. */
export function utcDayKey(at: Date): string {
  return utcDayStart(at).toISOString().slice(0, 10)
}

export interface ReportWindow {
  /** Inclusive, a UTC midnight. */
  start: Date
  /** Exclusive, a UTC midnight. */
  end: Date
}

/**
 * The trailing `lookbackDays` UTC calendar days ending with the one containing
 * `now`. The current day is included and will be partial until the next report
 * after UTC midnight; the receiver replaces a day on each re-report, so it
 * converges once the day has elapsed.
 */
export function reportWindow(now: Date, lookbackDays: number): ReportWindow {
  const end = new Date(utcDayStart(now).getTime() + DAY_MS)
  const start = new Date(end.getTime() - lookbackDays * DAY_MS)
  return { start, end }
}

export interface LedgerDayRow {
  day: string
  source: string
  category: string
  description: string
  events: number
  /** Dollars, as the decimal column renders. */
  cost: string | number
  inputTokens: number
  outputTokens: number
}

export interface ExecutionDayRow {
  day: string
  status: string
  executions: number
  durationMs: number
}

/**
 * Aggregates in the database so no per-execution row ever reaches this
 * process: the only things read back are counts and sums grouped by day.
 * `description` is kept only where it names a model (see `MODEL_CATEGORIES`);
 * every other category collapses to `(source, category)`.
 *
 * Runs on the replica when one is configured. A plain aggregate holds no
 * transaction, so it cannot pin a pooled connection across the scan.
 */
export async function readLedgerDays(
  window: ReportWindow,
  executor: DbClient = dbReplica
): Promise<LedgerDayRow[]> {
  const rows = await executor
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageLog.createdAt}), 'YYYY-MM-DD')`.as('day'),
      source: usageLog.source,
      category: usageLog.category,
      description: usageLog.description,
      events: sql<number>`COUNT(*)`.mapWith(Number).as('events'),
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`.as('cost'),
      inputTokens: sql<number>`
        COALESCE(SUM(CASE WHEN jsonb_typeof(${usageLog.metadata} -> 'inputTokens') = 'number'
          THEN (${usageLog.metadata} ->> 'inputTokens')::bigint ELSE 0 END), 0)`
        .mapWith(Number)
        .as('input_tokens'),
      outputTokens: sql<number>`
        COALESCE(SUM(CASE WHEN jsonb_typeof(${usageLog.metadata} -> 'outputTokens') = 'number'
          THEN (${usageLog.metadata} ->> 'outputTokens')::bigint ELSE 0 END), 0)`
        .mapWith(Number)
        .as('output_tokens'),
    })
    .from(usageLog)
    .where(and(gte(usageLog.createdAt, window.start), lt(usageLog.createdAt, window.end)))
    .groupBy(sql`day`, usageLog.source, usageLog.category, usageLog.description)
  return rows
}

export async function readExecutionDays(
  window: ReportWindow,
  executor: DbClient = dbReplica
): Promise<ExecutionDayRow[]> {
  const rows = await executor
    .select({
      day: sql<string>`to_char(date_trunc('day', ${workflowExecutionLogs.startedAt}), 'YYYY-MM-DD')`.as(
        'day'
      ),
      status: workflowExecutionLogs.status,
      executions: sql<number>`COUNT(*)`.mapWith(Number).as('executions'),
      durationMs: sql<number>`COALESCE(SUM(${workflowExecutionLogs.totalDurationMs}), 0)`
        .mapWith(Number)
        .as('duration_ms'),
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        gte(workflowExecutionLogs.startedAt, window.start),
        lt(workflowExecutionLogs.startedAt, window.end)
      )
    )
    .groupBy(sql`day`, workflowExecutionLogs.status)
  return rows
}

function toCredits(cost: string | number): number {
  const dollars = typeof cost === 'number' ? cost : Number.parseFloat(cost)
  if (!Number.isFinite(dollars)) return 0
  return Math.round(dollars * CREDIT_MULTIPLIER * 1e6) / 1e6
}

/**
 * Shapes grouped rows into one bucket per UTC day in the window. Days with no
 * activity are emitted as zeros so the receiver can tell "idle" from "not
 * reported". Pure, so the payload shape is testable without a database.
 */
export function buildUsageBuckets(
  window: ReportWindow,
  ledger: readonly LedgerDayRow[],
  executions: readonly ExecutionDayRow[]
): OnPremUsageBucket[] {
  const buckets = new Map<string, OnPremUsageBucket>()
  for (let at = window.start.getTime(); at < window.end.getTime(); at += DAY_MS) {
    const periodStart = new Date(at)
    buckets.set(utcDayKey(periodStart), {
      periodStart: periodStart.toISOString(),
      periodEnd: new Date(at + DAY_MS).toISOString(),
      workflowExecutions: 0,
      workflowExecutionsFailed: 0,
      workflowDurationMs: 0,
      credits: 0,
      inputTokens: 0,
      outputTokens: 0,
      sources: [],
      models: [],
    })
  }

  const sourceLines = new Map<string, Map<string, OnPremUsageSourceLine>>()
  const modelLines = new Map<string, Map<string, OnPremUsageModelLine>>()

  for (const row of ledger) {
    const bucket = buckets.get(row.day)
    if (!bucket) continue
    const credits = toCredits(row.cost)
    bucket.credits += credits
    bucket.inputTokens += row.inputTokens
    bucket.outputTokens += row.outputTokens

    const sources = sourceLines.get(row.day) ?? new Map()
    sourceLines.set(row.day, sources)
    const sourceKey = `${row.source}::${row.category}`
    const source = sources.get(sourceKey) ?? {
      source: row.source,
      category: row.category,
      events: 0,
      credits: 0,
    }
    source.events += row.events
    source.credits += credits
    sources.set(sourceKey, source)

    if (MODEL_CATEGORIES.has(row.category)) {
      const models = modelLines.get(row.day) ?? new Map()
      modelLines.set(row.day, models)
      const model = models.get(row.description) ?? {
        model: row.description,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        credits: 0,
      }
      model.events += row.events
      model.inputTokens += row.inputTokens
      model.outputTokens += row.outputTokens
      model.credits += credits
      models.set(row.description, model)
    }
  }

  for (const row of executions) {
    const bucket = buckets.get(row.day)
    if (!bucket) continue
    bucket.workflowExecutions += row.executions
    bucket.workflowDurationMs += row.durationMs
    if (row.status === 'failed') bucket.workflowExecutionsFailed += row.executions
  }

  for (const [day, bucket] of buckets) {
    bucket.credits = Math.round(bucket.credits * 1e6) / 1e6
    bucket.sources = [...(sourceLines.get(day)?.values() ?? [])].map((line) => ({
      ...line,
      credits: Math.round(line.credits * 1e6) / 1e6,
    }))
    bucket.models = [...(modelLines.get(day)?.values() ?? [])].map((line) => ({
      ...line,
      credits: Math.round(line.credits * 1e6) / 1e6,
    }))
  }

  return [...buckets.values()]
}

export async function collectUsageBuckets(window: ReportWindow): Promise<OnPremUsageBucket[]> {
  const [ledger, executions] = await Promise.all([
    readLedgerDays(window),
    readExecutionDays(window),
  ])
  return buildUsageBuckets(window, ledger, executions)
}
