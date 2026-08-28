import { dbReplica } from '@sim/db'
import { usageLog, user, workflow, workspace } from '@sim/db/schema'
import { and, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import type { UsageBreakdownDimension, UsageBucket } from '@/lib/billing/core/usage-analytics'
import { assertValidTimezone } from '@/lib/core/utils/timezone'
import type { DbClient } from '@/lib/db/types'

/**
 * DB half of organization usage analytics. Every read runs on the replica and takes
 * a prebuilt scope from `buildUsageAnalyticsScope`, so no query here decides period
 * semantics for itself.
 *
 * Index note (`usage_log_billing_entity_created_at_cost_idx` covers
 * `entityType, entityId, createdAt, userId, source, cost`): the series, the totals,
 * and the member/source breakdowns are index-only. `workspace_id`, `workflow_id`,
 * `description`, `metadata`, and `execution_id` are NOT in it, so the remaining
 * reads heap-fetch per row — which is why they are issued only for the dimension
 * actually being viewed.
 */

export interface UsageTimeSeriesRow {
  bucketStart: string | null
  cost: string
  events: number
}

/** Index-only: reads `created_at` and `cost`, both covered. */
export async function readUsageTimeSeries(
  scope: SQL[],
  bucket: UsageBucket,
  timezone: string,
  executor: DbClient = dbReplica
): Promise<UsageTimeSeriesRow[]> {
  assertValidTimezone(timezone)
  const bucketStart = sql<string | null>`to_char(
    date_trunc(${bucket}, ${usageLog.createdAt} AT TIME ZONE ${timezone}),
    'YYYY-MM-DD"T"HH24:MI:SS'
  )`

  return (
    executor
      .select({
        bucketStart: bucketStart.as('bucket_start'),
        cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
        events: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(usageLog)
      .where(and(...scope))
      // Group by the output alias, not the expression. Re-rendering the fragment here
      // emits a *textually different* one — the select list qualifies the column as
      // `created_at`, the group-by as `usage_log.created_at` — and Postgres matches
      // group-by expressions syntactically, so it rejects the query outright. It also
      // duplicates the bound parameters.
      .groupBy(sql`bucket_start`)
  )
}

export interface UsageTotals {
  cost: number
}

/**
 * The headline figure, and the only one first paint waits on.
 *
 * Deliberately just `SUM(cost)`. A `COUNT(DISTINCT user_id)` alongside it forces a
 * sort over every matching row — measured at 830ms of a 909ms query on production's
 * largest organization (342k rows in a 30-day window), and the summary runs it twice
 * because the delta compares two windows. Without it the same query is 79ms. Any
 * per-actor figure added here must earn that cost by actually being displayed.
 */
export async function readUsageTotals(
  scope: SQL[],
  executor: DbClient = dbReplica
): Promise<UsageTotals> {
  const [row] = await executor
    .select({
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
    })
    .from(usageLog)
    .where(and(...scope))

  return { cost: Number.parseFloat(row?.cost ?? '0') || 0 }
}

export interface UsageBreakdownRow {
  key: string | null
  cost: string
  events: number
  /** Model dimensions only — the ledger records tokens only for model categories. */
  inputTokens?: number
  outputTokens?: number
}

/** Dimensions keyed on `description`, which holds a model name for model categories. */
const MODEL_DIMENSIONS = new Set<UsageBreakdownDimension>(['model', 'byok'])

function breakdownColumn(dimension: UsageBreakdownDimension) {
  switch (dimension) {
    case 'member':
      return usageLog.userId
    case 'workspace':
      return usageLog.workspaceId
    case 'workflow':
      return usageLog.workflowId
    case 'source':
      return usageLog.source
    case 'model':
    case 'byok':
      return usageLog.description
  }
}

/**
 * Ranked totals for one dimension.
 *
 * Aggregate-first: names are hydrated by {@link readUsageEntityNames} for the
 * surviving keys only. Joining inside the aggregate would break index-only for
 * `member` and force a nested loop across the whole window.
 */
export async function readUsageBreakdown(
  scope: SQL[],
  dimension: UsageBreakdownDimension,
  /** Narrows to one workspace, for the Workspaces drill-down. */
  workspaceId: string | undefined,
  executor: DbClient = dbReplica
): Promise<UsageBreakdownRow[]> {
  const column = breakdownColumn(dimension)
  const conditions = [...scope]
  if (workspaceId) conditions.push(eq(usageLog.workspaceId, workspaceId))
  /**
   * `description` holds a model name only for the model categories; a tool or fixed
   * row would otherwise appear as a phantom "model". The two model dimensions split
   * on who paid: `model` is what Sim charged for, `byok` is the customer's own key.
   */
  if (dimension === 'model') conditions.push(eq(usageLog.category, 'model'))
  if (dimension === 'byok') conditions.push(eq(usageLog.category, 'model_unbilled'))
  /**
   * Only `source = 'workflow'` rows ever carry a `workflow_id` — Chat, Agent block,
   * Wand, knowledge base, and voice have none by construction, not by omission. So a
   * workflow list excludes them outright; bucketing them into an "other" row put most
   * of an organization's usage into a list it does not belong in.
   */
  if (dimension === 'workflow') conditions.push(isNotNull(usageLog.workflowId))

  if (!MODEL_DIMENSIONS.has(dimension)) {
    return (
      executor
        .select({
          key: sql<string | null>`${column}`,
          cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
          events: sql<number>`COUNT(*)`.mapWith(Number),
        })
        .from(usageLog)
        .where(and(...conditions))
        .groupBy(column)
        /**
         * Drops groups whose every row is reporting-only. Unbilled rows carry a user,
         * a workspace, a workflow and `source = 'workflow'` like any other, so without
         * this a BYOK-only member appeared in a credit-denominated list at 0 credits.
         *
         * As a `HAVING` on the aggregate rather than a `category` predicate on purpose:
         * `category` is not in `usage_log_billing_entity_created_at_cost_idx`, so
         * filtering on it would force a heap fetch on `member` and `source` — the two
         * dimensions that are index-only today. `cost` is in that index, and only an
         * unbilled row can sum to zero, since `recordUsage` admits nothing else at zero.
         */
        .having(sql`COALESCE(SUM(${usageLog.cost}), 0) > 0`)
    )
  }

  // Already heap-reading `description`, so summing `metadata` costs nothing extra —
  // and BYOK rows carry no cost at all, making tokens the only usage they can show.
  return executor
    .select({
      key: sql<string | null>`${column}`,
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
      events: sql<number>`COUNT(*)`.mapWith(Number),
      inputTokens:
        sql<string>`COALESCE(SUM((${usageLog.metadata}->>'inputTokens')::bigint), 0)`.mapWith(
          Number
        ),
      outputTokens:
        sql<string>`COALESCE(SUM((${usageLog.metadata}->>'outputTokens')::bigint), 0)`.mapWith(
          Number
        ),
    })
    .from(usageLog)
    .where(and(...conditions))
    .groupBy(column)
}

/**
 * Display names for the top-N keys of an entity-backed dimension.
 *
 * Members fall back to email because a user may have no name set, and an empty row
 * label is worse than an address.
 */
export async function readUsageEntityNames(
  dimension: UsageBreakdownDimension,
  ids: string[],
  executor: DbClient = dbReplica
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()

  if (dimension === 'member') {
    const rows = await executor
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, ids))
    return new Map(rows.map((row) => [row.id, row.name?.trim() || row.email]))
  }

  if (dimension === 'workspace') {
    const rows = await executor
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(inArray(workspace.id, ids))
    return new Map(rows.map((row) => [row.id, row.name]))
  }

  if (dimension === 'workflow') {
    const rows = await executor
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(inArray(workflow.id, ids))
    return new Map(rows.map((row) => [row.id, row.name]))
  }

  return new Map()
}
