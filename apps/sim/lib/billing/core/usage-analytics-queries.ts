import { dbReplica } from '@sim/db'
import { usageLog, user, workflow, workspace } from '@sim/db/schema'
import { and, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import {
  buildUsageAnalyticsScope,
  mergeRowsByKey,
  sumUsageDays,
  USAGE_MODEL_DIMENSIONS,
  type UsageAnalyticsWindow,
  type UsageBreakdownDimension,
  type UsageBucket,
  type UsageGroupRow,
  usageWindowSegments,
} from '@/lib/billing/core/usage-analytics'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { readThroughSegments } from '@/lib/billing/core/usage-segment-cache'
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
  const buckets = executor
    .select({
      bucketStart:
        sql`date_trunc(${bucket}, (${usageLog.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})`.as(
          'bucket_start'
        ),
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`.as('cost'),
      events: sql<number>`COUNT(*)`.mapWith(Number).as('events'),
    })
    .from(usageLog)
    .where(and(...scope))
    .groupBy(sql`bucket_start`)
    .as('buckets')

  /** Format the aggregated buckets rather than every ledger entry. */
  return executor
    .select({
      bucketStart: sql<string | null>`to_char(${buckets.bucketStart}, 'YYYY-MM-DD"T"HH24:MI:SS')`,
      cost: buckets.cost,
      events: buckets.events,
    })
    .from(buckets)
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

/** The rows a dimension ranks: the scope, narrowed to what that dimension can describe. */
function breakdownConditions(scope: SQL[], dimension: UsageBreakdownDimension): SQL[] {
  const conditions = [...scope]
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
  return conditions
}

/**
 * One dimension's totals per local hour (`YYYY-MM-DDTHH`) or day (`YYYY-MM-DD`) of the
 * viewer.
 *
 * Hours for the segment cache, which settles today hour by hour; days wherever
 * nothing is cached, which returns a twenty-fourth of the rows. No `HAVING` here,
 * unlike {@link readUsageBreakdown}: whether a group is billed is a property of its
 * whole window, so the caller filters after summing — a per-stretch filter would drop
 * the unbilled stretches of a group that is billed in others.
 */
export async function readUsageBreakdownOverTime(
  scope: SQL[],
  dimension: UsageBreakdownDimension,
  timezone: string,
  granularity: 'hour' | 'day',
  executor: DbClient = dbReplica
): Promise<Map<string, UsageGroupRow[]>> {
  assertValidTimezone(timezone)
  const column = breakdownColumn(dimension)
  const withTokens = USAGE_MODEL_DIMENSIONS.has(dimension)
  const grouped = executor
    .select({
      stretch:
        sql`date_trunc(${granularity}, (${usageLog.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})`.as(
          'stretch'
        ),
      key: sql<string | null>`${column}`.as('key'),
      cost: sql<string>`SUM(${usageLog.cost})`.as('cost'),
      events: sql<number>`COUNT(*)`.mapWith(Number).as('events'),
      inputTokens: (withTokens
        ? sql<number>`SUM((${usageLog.metadata}->>'inputTokens')::bigint)`
        : sql<number>`0`
      )
        .mapWith(Number)
        .as('input_tokens'),
      outputTokens: (withTokens
        ? sql<number>`SUM((${usageLog.metadata}->>'outputTokens')::bigint)`
        : sql<number>`0`
      )
        .mapWith(Number)
        .as('output_tokens'),
    })
    .from(usageLog)
    .where(and(...breakdownConditions(scope, dimension)))
    .groupBy(sql`1`, sql`2`)
    .as('grouped')

  /** Format the aggregated groups rather than every ledger entry. */
  const rows = await executor
    .select({
      stretch: sql<string>`to_char(${grouped.stretch}, ${granularity === 'hour' ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD'})`,
      key: grouped.key,
      cost: grouped.cost,
      events: grouped.events,
      inputTokens: grouped.inputTokens,
      outputTokens: grouped.outputTokens,
    })
    .from(grouped)

  const byStretch = new Map<string, UsageGroupRow[]>()
  for (const row of rows) {
    const entry: UsageGroupRow = {
      key: row.key,
      cost: Number.parseFloat(row.cost) || 0,
      events: row.events,
      ...(withTokens
        ? { inputTokens: row.inputTokens || 0, outputTokens: row.outputTokens || 0 }
        : {}),
    }
    const stretchRows = byStretch.get(row.stretch)
    if (stretchRows) stretchRows.push(entry)
    else byStretch.set(row.stretch, [entry])
  }
  return byStretch
}

/**
 * Ledger rows are immutable once settled, so a usage segment only expires to heal a
 * straggler and to release organizations nobody is viewing.
 */
const USAGE_SEGMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface ReadUsageDaysArgs {
  entity: BillingEntity
  window: UsageAnalyticsWindow
  timezone: string
  dimension: UsageBreakdownDimension
  workspaceId?: string
}

/**
 * {@link readUsageBreakdownOverTime} for a whole window as `[day, rows]` entries, with
 * settled days and hours from the cache. A day can appear in more than one entry.
 *
 * A window matched on `created_at` — any range, or a reporting period — cuts cleanly
 * at the viewer's midnights and hours, so each settled stretch is read once and
 * reused by every later view. A stripe or default period matches the stamps rows
 * carry rather than when they were created, so it has nothing to cut and reads the
 * ledger directly.
 */
export async function readUsageDays({
  entity,
  window,
  timezone,
  dimension,
  workspaceId,
}: ReadUsageDaysArgs): Promise<[string, UsageGroupRow[]][]> {
  if (window.kind === 'period' && window.period.source !== 'reporting') {
    return [
      ...(await readUsageBreakdownOverTime(
        buildUsageAnalyticsScope(entity, window, workspaceId),
        dimension,
        timezone,
        'day'
      )),
    ]
  }
  return readThroughSegments<UsageGroupRow[]>({
    namespace: `${entity.type}:${entity.id}:${workspaceId ?? '*'}:${timezone}:${dimension}`,
    segments: usageWindowSegments(window, timezone),
    empty: [],
    combine: (values) => mergeRowsByKey(values.flat(), (key) => key),
    ttlMs: USAGE_SEGMENT_TTL_MS,
    fetchRange: (from, to) =>
      readUsageBreakdownOverTime(
        buildUsageAnalyticsScope(entity, { kind: 'range', from, to }, workspaceId),
        dimension,
        timezone,
        'hour'
      ),
  })
}

interface ReadUsageGroupsArgs extends ReadUsageDaysArgs {
  /** Refuses a window with more groups than this — the public API's bound. */
  maxRows?: number
}

/**
 * One dimension's usage per key over a whole window — the one entry point a ranking
 * reads through, whichever store answers it.
 *
 * Every dimension but `workflow` has at most a few hundred keys a day and reads
 * through the segment cache. Workflows can number in the thousands, so a window of
 * them per hour would be a large cache entry for a list only the Workspaces drill-down
 * shows. They, and any read with a `maxRows` bound — the public API's — go to the
 * ledger directly, where the bound stops the scan instead of a full window being
 * summed first. A capped read can return one row past `maxRows`, which is how the
 * caller knows the window was too large.
 */
export async function readUsageGroups({
  maxRows,
  ...args
}: ReadUsageGroupsArgs): Promise<UsageGroupRow[]> {
  if (args.dimension === 'workflow' || maxRows !== undefined) {
    const rows = await readUsageBreakdown(
      buildUsageAnalyticsScope(args.entity, args.window, args.workspaceId),
      args.dimension,
      undefined,
      maxRows
    )
    return mergeRowsByKey(rows, (key) => key)
  }
  return sumUsageDays(await readUsageDays(args), {
    billedOnly: !USAGE_MODEL_DIMENSIONS.has(args.dimension),
  })
}

/**
 * Ranked totals for one dimension.
 *
 * Aggregate-first: names and avatars are hydrated by {@link readUsageEntities} for the
 * surviving keys only. Joining inside the aggregate would break index-only for
 * `member` and force a nested loop across the whole window.
 */
export async function readUsageBreakdown(
  scope: SQL[],
  dimension: UsageBreakdownDimension,
  executor: DbClient = dbReplica,
  maxRows?: number
): Promise<UsageBreakdownRow[]> {
  const column = breakdownColumn(dimension)
  const conditions = breakdownConditions(scope, dimension)

  if (!USAGE_MODEL_DIMENSIONS.has(dimension)) {
    const query = executor
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
    return maxRows === undefined ? query : query.limit(maxRows + 1)
  }

  // Already heap-reading `description`, so summing `metadata` costs nothing extra —
  // and BYOK rows carry no cost at all, making tokens the only usage they can show.
  const query = executor
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
  return maxRows === undefined ? query : query.limit(maxRows + 1)
}

export interface UsageEntity {
  name: string
  image?: string
}

/**
 * Names, and member avatars, for the top-N keys of an entity-backed dimension.
 *
 * Members fall back to email because a user may have no name set, and an empty row
 * label is worse than an address.
 */
export async function readUsageEntities(
  dimension: UsageBreakdownDimension,
  ids: string[],
  executor: DbClient = dbReplica
): Promise<Map<string, UsageEntity>> {
  if (ids.length === 0) return new Map()

  if (dimension === 'member') {
    const rows = await executor
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(inArray(user.id, ids))
    return new Map(
      rows.map((row) => [
        row.id,
        { name: row.name?.trim() || row.email, ...(row.image ? { image: row.image } : {}) },
      ])
    )
  }

  if (dimension === 'workspace') {
    const rows = await executor
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(inArray(workspace.id, ids))
    return new Map(rows.map((row) => [row.id, { name: row.name }]))
  }

  if (dimension === 'workflow') {
    const rows = await executor
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(inArray(workflow.id, ids))
    return new Map(rows.map((row) => [row.id, { name: row.name }]))
  }

  return new Map()
}
