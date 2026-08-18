import { db } from '@sim/db'
import { usageLog, usageLogDailyTotal } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gte, inArray, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import type { BillingEntity, UsageLogSource } from '@/lib/billing/core/usage-log'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import type { DbClient, DbOrTx } from '@/lib/db/types'

const logger = createLogger('UsageDailyTotal')

export const MS_PER_DAY = 86_400_000

export interface BillingPeriodRange {
  start: Date
  end: Date
}

/**
 * The day bucket an event falls in: whole 24h windows from the period start.
 *
 * {@link dayIndexSql} is the same expression evaluated in the database. Both
 * exist because buckets are written from application code but recomputed — and
 * read back by the ledger fallback — in SQL, and the two must agree exactly.
 * They derive from this one definition rather than from hand-copied
 * `floor(… / 86400)` expressions that can silently drift apart.
 */
export function dayIndexFor(periodStart: Date, occurredAt: Date): number {
  return Math.floor((occurredAt.getTime() - periodStart.getTime()) / MS_PER_DAY)
}

/**
 * {@link dayIndexFor} as a SQL expression.
 *
 * Keeps full precision rather than taking a pre-truncated epoch, so it buckets
 * events identically to `dayIndexFor` even when a period start carries a
 * sub-second component.
 *
 * Both operands must already be column references or bound parameters. A bare
 * `Date` cannot be passed: drizzle replaces postgres-js's temporal serializer
 * with an identity function and encodes timestamps itself, so a Date outside
 * column context never gets serialized. Callers holding a Date bind it with
 * `sql.param(date, table.column)`.
 */
export function dayIndexSql(createdAt: SQLWrapper, periodStart: SQLWrapper): SQL {
  // Both operands are cast explicitly: `extract(epoch from $1)` on a bare bind
  // parameter is ambiguous to Postgres ("function pg_catalog.extract(unknown,
  // unknown) is not unique") and fails at runtime — which neither type-checking
  // nor mocked unit tests catch.
  return sql`floor((extract(epoch from ${createdAt}::timestamp) - extract(epoch from ${periodStart}::timestamp)) / 86400)::int`
}

/**
 * Applies a signed delta to one `(user, day)` bucket.
 *
 * Must run inside the same transaction as the `usage_log` mutation it accounts
 * for. The upsert is a single statement, so concurrent writers serialize on the
 * row rather than on a read-modify-write in application code, and a rolled-back
 * ledger write rolls the bucket back with it.
 *
 * A zero delta is skipped so a no-op flush does not manufacture a row version.
 */
export async function applyUsageDailyTotalDelta(
  executor: DbOrTx,
  billingEntity: BillingEntity,
  billingPeriod: BillingPeriodRange,
  /** The `usage_log.user_id` the ledger rows were written under. */
  userId: string,
  source: UsageLogSource,
  occurredAt: Date,
  delta: number
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) {
    return
  }

  await executor
    .insert(usageLogDailyTotal)
    .values({
      billingEntityType: billingEntity.type,
      billingEntityId: billingEntity.id,
      billingPeriodStart: billingPeriod.start,
      billingPeriodEnd: billingPeriod.end,
      userId,
      dayIndex: dayIndexFor(billingPeriod.start, occurredAt),
      source,
      totalCost: delta.toString(),
    })
    .onConflictDoUpdate({
      target: [
        usageLogDailyTotal.billingEntityType,
        usageLogDailyTotal.billingEntityId,
        usageLogDailyTotal.billingPeriodStart,
        usageLogDailyTotal.billingPeriodEnd,
        usageLogDailyTotal.userId,
        usageLogDailyTotal.dayIndex,
        usageLogDailyTotal.source,
      ],
      set: {
        totalCost: sql`${usageLogDailyTotal.totalCost} + ${delta.toString()}::numeric`,
        updatedAt: sql`now()`,
      },
    })
}

/**
 * Whether reads may be served from the rollup at all.
 *
 * Owned here rather than at each call site so that turning reads off is one
 * switch, and so a new consumer cannot forget it: a disabled flag funnels into
 * the same `null` every read below already uses for "cannot answer — aggregate
 * the ledger instead".
 */
async function rollupReadsEnabled(): Promise<boolean> {
  return isFeatureEnabled('usage-daily-total-reads')
}

/**
 * The bucket-key prefix every read scopes on.
 *
 * Shared so the scope cannot drift between readers: if the key changes, it
 * changes in one place. Callers add their own narrowing on top — which is
 * deliberately NOT folded in here, because the two readers scope differently
 * and that difference is load-bearing.
 */
function periodScope(billingEntity: BillingEntity, periodStart: Date) {
  return and(
    eq(usageLogDailyTotal.billingEntityType, billingEntity.type),
    eq(usageLogDailyTotal.billingEntityId, billingEntity.id),
    eq(usageLogDailyTotal.billingPeriodStart, periodStart)
  )
}

/**
 * The bucket cost aggregate. `SUM` over no rows is `NULL`, never `'0'`.
 *
 * Built per call rather than held as a module constant: a constant evaluates
 * the `sql` tag at import time, which makes merely importing this module fail
 * anywhere `drizzle-orm` is partially mocked without `sql` — including tests
 * that only reach billing transitively and never touch the rollup.
 */
function bucketCostSum() {
  return sql<string | null>`SUM(${usageLogDailyTotal.totalCost})`
}

/**
 * Folds grouped bucket rows into a keyed cost map.
 *
 * Returns `null` for an empty result — the shared "no buckets, aggregate the
 * ledger instead" signal — so no reader has to restate it.
 */
function toCostMap<Row extends { totalCost: string | null }, Key>(
  rows: Row[],
  keyOf: (row: Row) => Key
): Map<Key, number> | null {
  if (rows.length === 0) {
    return null
  }
  return new Map(rows.map((row) => [keyOf(row), Number.parseFloat(row.totalCost ?? '0')]))
}

/**
 * Reads the period's cost broken down by source.
 *
 * One read answers every whole-period aggregate: the unfiltered total is the
 * sum of the map, a source-filtered total is the sum of the matching entries,
 * and the Chat-family breakdown is both at once — so those callers no longer
 * need a query shape each, and the source-filtered ones stop falling back to
 * the ledger entirely.
 *
 * At most one entry per source, so the map stays small no matter how many
 * events the period holds.
 *
 * Returns `null` when the rollup cannot answer: reads are disabled, or the
 * period has no buckets. "No buckets" is distinct from a total of zero — it
 * means this (entity, period) has not been written since the rollup began
 * being maintained, so the caller must aggregate the ledger rather than report
 * no usage.
 */
export async function readUsagePeriodTotalsBySource(
  billingEntity: BillingEntity,
  billingPeriod: BillingPeriodRange,
  executor: DbClient = db
): Promise<Map<UsageLogSource, number> | null> {
  if (!(await rollupReadsEnabled())) {
    return null
  }

  const rows = await executor
    .select({ source: usageLogDailyTotal.source, totalCost: bucketCostSum() })
    .from(usageLogDailyTotal)
    .where(
      and(
        periodScope(billingEntity, billingPeriod.start),
        eq(usageLogDailyTotal.billingPeriodEnd, billingPeriod.end)
      )
    )
    .groupBy(usageLogDailyTotal.source)

  return toCostMap(rows, (row) => row.source)
}

/**
 * Totals a source breakdown, optionally restricted to a set of sources.
 *
 * Keeps "which sources count" a caller's concern and "how a breakdown becomes
 * a number" a single one.
 */
export function sumSourceTotals(
  totals: Map<UsageLogSource, number>,
  sources?: UsageLogSource[]
): number {
  let total = 0
  if (!sources) {
    for (const cost of totals.values()) total += cost
    return total
  }
  // Walk the breakdown and test membership, rather than walking `sources` and
  // looking each up: a caller that passes the same source twice would
  // otherwise count that bucket twice.
  const wanted = new Set(sources)
  for (const [source, cost] of totals) {
    if (wanted.has(source)) total += cost
  }
  return total
}

/**
 * Reads per-day totals for a set of users, summed across those users.
 *
 * Sums across sources, which the day-grain aggregate does not distinguish.
 *
 * Returns `null` for the same reasons {@link readUsagePeriodTotalsBySource}
 * does.
 *
 * Deliberately does NOT filter `billingPeriodEnd`, even though it is part of
 * the key: the ledger aggregate this stands in for scopes on
 * `(type, id, period_start)` only, so adding the end would make this read
 * narrower than the ledger and under-report if a period start ever carried two
 * different ends.
 */
export async function readUsageDailyTotals(
  billingEntity: BillingEntity,
  periodStart: Date,
  userIds: string[],
  executor: DbClient = db
): Promise<Map<number, number> | null> {
  if (!(await rollupReadsEnabled())) {
    return null
  }
  if (userIds.length === 0) {
    return new Map()
  }

  const rows = await executor
    .select({ dayIndex: usageLogDailyTotal.dayIndex, totalCost: bucketCostSum() })
    .from(usageLogDailyTotal)
    .where(
      and(
        periodScope(billingEntity, periodStart),
        inArray(usageLogDailyTotal.userId, userIds),
        // Mirrors the ledger query's `created_at >= period_start`. No upper
        // bound is needed: callers only take this path for a period still
        // capped at `now`, and no bucket can exist beyond that.
        gte(usageLogDailyTotal.dayIndex, 0)
      )
    )
    .groupBy(usageLogDailyTotal.dayIndex)

  return toCostMap(rows, (row) => row.dayIndex)
}

/**
 * Recomputes buckets from the ledger, which stays the source of truth.
 *
 * The rollup is maintained transactionally and so should never drift, but it is
 * a derived billing number — this exists so drift is always recoverable rather
 * than permanent, and so buckets can be populated for periods that predate the
 * rollup without a migration-time backfill (which would have raced the deploy:
 * between the migration and the new image being live, the old code writes
 * ledger rows without maintaining the rollup, leaving a stale base that every
 * later increment would build on).
 *
 * `usage_log.user_id` cascades on user deletion, which removes ledger rows
 * without lowering the buckets they fed — the one non-transactional drift
 * source. Recomputing the surviving groups is not enough to repair it, because
 * a group whose ledger rows are *entirely* gone has nothing left to recompute
 * from and would keep its stale total forever, so orphaned buckets are deleted
 * outright rather than just refreshed.
 *
 * Writes absolute totals, which is what makes it a repair rather than another
 * increment — but an absolute write computed from a snapshot can clobber a
 * concurrent live increment. Two things keep that in check:
 *
 * - Both passes run in one transaction, so the delete cannot act on a view of
 *   the ledger the upsert never saw.
 * - Every bucket a live writer has touched since this transaction began is
 *   left alone. Live maintenance is exact, so skipping such a bucket is always
 *   safe; overwriting it with an older snapshot's total would not be.
 *
 * The residual window is a ledger write that began before this transaction and
 * commits after its snapshot: its row is invisible here while its bucket still
 * looks untouched, so the recomputed total omits it. That window is one usage
 * write long. Re-running repairs it, which is why this is idempotent and why
 * the script reports what it touched rather than claiming completeness.
 */
export async function reconcileUsageDailyTotals(options?: {
  /** Only reconcile periods that end at or after this instant. */
  periodEndsAfter?: Date
  executor?: DbClient
}): Promise<{ bucketsWritten: number; bucketsDeleted: number }> {
  const executor = options?.executor ?? db
  const periodEndsAfter = options?.periodEndsAfter
  const ledgerPeriodScope = periodEndsAfter
    ? sql`and ${usageLog.billingPeriodEnd} >= ${periodEndsAfter}`
    : sql``

  /**
   * Every key column is required explicitly rather than relying on
   * `billing_entity_type` alone. `usage_log_billing_scope_all_or_none` does
   * enforce all-or-none, but it is `NOT VALID` — so it binds new writes while
   * saying nothing about rows that predate it. A single row with a null key
   * column would make its `day_index` null too, and both are `NOT NULL` here,
   * which would abort the whole all-or-nothing reconcile rather than skip one
   * row. Such a row could not be read back through the rollup anyway: every
   * read matches on all four.
   */
  const ledgerBuckets = sql`
    select
      ${usageLog.billingEntityType} as billing_entity_type,
      ${usageLog.billingEntityId} as billing_entity_id,
      ${usageLog.billingPeriodStart} as billing_period_start,
      ${usageLog.billingPeriodEnd} as billing_period_end,
      ${usageLog.userId} as user_id,
      ${dayIndexSql(usageLog.createdAt, usageLog.billingPeriodStart)} as day_index,
      ${usageLog.source} as source,
      coalesce(sum(${usageLog.cost}), 0) as total_cost
    from ${usageLog}
    where ${usageLog.billingEntityType} is not null
      and ${usageLog.billingEntityId} is not null
      and ${usageLog.billingPeriodStart} is not null
      and ${usageLog.billingPeriodEnd} is not null
      ${ledgerPeriodScope}
    group by 1, 2, 3, 4, 5, 6, 7
  `

  const { written, deleted } = await executor.transaction(async (tx) => {
    const writtenRows = await tx.execute(sql`
    insert into ${usageLogDailyTotal} (
      billing_entity_type, billing_entity_id, billing_period_start,
      billing_period_end, user_id, day_index, source, total_cost, updated_at
    )
    select
      billing_entity_type, billing_entity_id, billing_period_start,
      billing_period_end, user_id, day_index, source, total_cost, now()
    from (${ledgerBuckets}) as ledger
    on conflict (
      billing_entity_type, billing_entity_id, billing_period_start,
      billing_period_end, user_id, day_index, source
    ) do update set
      total_cost = excluded.total_cost,
      updated_at = now()
    where ${usageLogDailyTotal}.updated_at < now()
    returning 1
  `)

    const deletedRows = await tx.execute(sql`
    delete from ${usageLogDailyTotal} as rollup
    where ${periodEndsAfter ? sql`rollup.billing_period_end >= ${periodEndsAfter} and` : sql``}
      not exists (
        select 1
        from (${ledgerBuckets}) as ledger
        where ledger.billing_entity_type = rollup.billing_entity_type
          and ledger.billing_entity_id = rollup.billing_entity_id
          and ledger.billing_period_start = rollup.billing_period_start
          and ledger.billing_period_end = rollup.billing_period_end
          and ledger.user_id = rollup.user_id
          and ledger.day_index = rollup.day_index
          and ledger.source = rollup.source
      )
      and rollup.updated_at < now()
    returning 1
  `)

    return { written: writtenRows, deleted: deletedRows }
  })

  const bucketsWritten = Array.isArray(written) ? written.length : 0
  const bucketsDeleted = Array.isArray(deleted) ? deleted.length : 0
  logger.info('Reconciled usage daily totals', {
    bucketsWritten,
    bucketsDeleted,
    periodEndsAfter,
  })
  return { bucketsWritten, bucketsDeleted }
}
