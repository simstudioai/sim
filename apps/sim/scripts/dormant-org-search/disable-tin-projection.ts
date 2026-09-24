#!/usr/bin/env bun

/**
 * Stops maintaining the Tin keyword projection and empties it, keeping the table, its indexes and
 * the Tin functions so the schema and the code that reads it stay valid.
 *
 * Drops exactly the triggers that write `embedding_keyword_tin` in a writer's transaction:
 * - `embedding_keyword_tin_sync` on `embedding` (installed by `0019_tin_keyword_projection`,
 *   re-guarded by `0024_knowledge_projection_async`)
 * - `knowledge_base_keyword_tin_sync` on `knowledge_base` (`0019`)
 * - `embedding_keyword_tin_source_acl_set` on `embedding_keyword_tin` (`0021`, re-guarded by `0024`)
 *
 * then truncates the table, all in one transaction. The document trigger's source and ACL fan-out
 * (`sync_projection_source_acl`, `0024`) also updates `embedding_keyword_tin` inline; it is shared
 * with `embedding_search`, so it is left as it is and becomes an index probe of an empty table.
 * `restore-tin-projection.ts` reinstalls the dropped triggers from the migrations that own them.
 *
 * Usage:
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/disable-tin-projection.ts            # dry run
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/disable-tin-projection.ts --execute
 *
 * Exit codes: 0 done (or nothing to do), 1 failed.
 */

import { parseArgs } from 'node:util'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { Sql } from 'postgres'
import {
  connectMigrationRole,
  parsePositiveInteger,
  resolveExecuteFlag,
} from '@/scripts/dormant-org-search/cli'

const logger = createLogger('DisableTinProjection')

/** The triggers that write the Tin projection in the writer's transaction, in lock order. */
export const TIN_TRIGGERS = [
  { name: 'embedding_keyword_tin_sync', table: 'embedding' },
  { name: 'knowledge_base_keyword_tin_sync', table: 'knowledge_base' },
  { name: 'embedding_keyword_tin_source_acl_set', table: 'embedding_keyword_tin' },
] as const

export type TinTrigger = (typeof TIN_TRIGGERS)[number]

/**
 * How long each attempt may queue for the table locks. `DROP TRIGGER` and `TRUNCATE` take ACCESS
 * EXCLUSIVE locks, and a queued ACCESS EXCLUSIVE request blocks every later reader of the table,
 * including search's reads of `knowledge_base`, for as long as it waits; the retries below find a
 * quiet moment instead of waiting long once.
 */
const LOCK_TIMEOUT = '3s'
const DEFAULT_RETRY_BUDGET_MINUTES = 20
const RETRY_BACKOFF = { baseMs: 2_000, maxMs: 30_000 } as const

export interface TinProjectionState {
  /** Tin triggers present now, of {@link TIN_TRIGGERS}. */
  triggers: TinTrigger[]
  /** Whether the projection holds any row, read directly. */
  hasRows: boolean
  /**
   * Planner estimate of the projection's rows, since exact counting would read the whole table.
   * It is -1 until the table is first analyzed and lags a truncate until the next analyze.
   */
  estimatedRows: number
  totalBytes: number
  /** Whether `0019` installed the Tin functions here; absent where the database has no `tin`. */
  functionsInstalled: boolean
}

export interface TinProjectionDatabase {
  readState(): Promise<TinProjectionState>
  /** Drops {@link TIN_TRIGGERS} and truncates the projection in one transaction. */
  dropTriggersAndTruncate(): Promise<void>
}

export interface DisableTinProjectionResult {
  executed: boolean
  before: TinProjectionState
  after: TinProjectionState | null
}

/**
 * Reports the projection's state and, when `execute` is set and there is anything to remove,
 * drops the triggers and truncates the table. Idempotent: a second run finds nothing to drop and
 * an empty table, and truncates again only if something wrote rows meanwhile.
 */
export async function disableTinProjection(
  database: TinProjectionDatabase,
  options: { execute: boolean }
): Promise<DisableTinProjectionResult> {
  const before = await database.readState()
  logger.info('Tin projection state', {
    triggers: before.triggers.map((trigger) => `${trigger.name} ON ${trigger.table}`),
    hasRows: before.hasRows,
    estimatedRows: before.estimatedRows,
    totalBytes: before.totalBytes,
    functionsInstalled: before.functionsInstalled,
  })
  if (before.triggers.length === 0 && !before.hasRows) {
    logger.info('Nothing to do: no Tin triggers and an empty projection')
    return { executed: false, before, after: null }
  }
  if (!options.execute) {
    logger.info('Dry run: would drop the triggers above and TRUNCATE embedding_keyword_tin', {
      drop: before.triggers.map((trigger) => trigger.name),
    })
    return { executed: false, before, after: null }
  }
  await database.dropTriggersAndTruncate()
  const after = await database.readState()
  logger.info('Tin projection disabled', {
    remainingTriggers: after.triggers.map((trigger) => trigger.name),
    hasRows: after.hasRows,
    totalBytes: after.totalBytes,
  })
  if (after.triggers.length > 0) {
    throw new Error('Tin triggers are still installed after the drop')
  }
  if (after.hasRows) {
    logger.warn(
      'The projection gained rows after the truncate: a release that predates the indexed search gate, or runs with SIM_SEARCH_LIVE=false, still projects Tin rows for marked search-index documents'
    )
  }
  return { executed: true, before, after }
}

/** The postgres.js implementation, on the migrations role's single connection. */
export function postgresTinProjectionDatabase(
  sql: Sql,
  options: { retryBudgetMs: number }
): TinProjectionDatabase {
  return {
    async readState() {
      const present = await sql<Array<{ name: string; table: string }>>`
        SELECT t.tgname AS name, c.relname AS table
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal
          AND t.tgname IN ${sql(TIN_TRIGGERS.map((trigger) => trigger.name))}`
      const triggers = TIN_TRIGGERS.filter((trigger) =>
        present.some((row) => row.name === trigger.name && row.table === trigger.table)
      )
      const [size] = await sql<
        Array<{ estimated_rows: string | null; total_bytes: string | null; functions: boolean }>
      >`
        SELECT c.reltuples::bigint AS estimated_rows,
          pg_total_relation_size(c.oid)::bigint AS total_bytes,
          to_regprocedure('knowledge_tin_stream(tsvector)') IS NOT NULL AS functions
        FROM pg_class c WHERE c.oid = to_regclass('embedding_keyword_tin')`
      const [heap] = await sql<Array<{ has_rows: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM embedding_keyword_tin) AS has_rows`
      return {
        triggers,
        hasRows: Boolean(heap?.has_rows),
        estimatedRows: Number(size?.estimated_rows ?? 0),
        totalBytes: Number(size?.total_bytes ?? 0),
        functionsInstalled: Boolean(size?.functions),
      }
    },
    async dropTriggersAndTruncate() {
      await retryOnLockTimeout(
        () =>
          sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`)
            for (const trigger of TIN_TRIGGERS) {
              await tx.unsafe(`DROP TRIGGER IF EXISTS ${trigger.name} ON ${trigger.table}`)
            }
            await tx.unsafe('TRUNCATE embedding_keyword_tin')
          }),
        {
          budgetMs: options.retryBudgetMs,
          backoff: RETRY_BACKOFF,
          onRetry: ({ attempt, delayMs }) =>
            logger.warn('Tin drop waited out its lock timeout; retrying', {
              attempt,
              retryInMs: Math.round(delayMs),
            }),
        }
      )
    },
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'retry-budget-minutes': { type: 'string' },
    },
    strict: true,
  })
  const execute = resolveExecuteFlag(values)
  const retryBudgetMinutes = parsePositiveInteger(
    'retry-budget-minutes',
    values['retry-budget-minutes'],
    DEFAULT_RETRY_BUDGET_MINUTES
  )
  const sql = connectMigrationRole()
  try {
    await disableTinProjection(
      postgresTinProjectionDatabase(sql, { retryBudgetMs: retryBudgetMinutes * 60_000 }),
      { execute }
    )
  } finally {
    await sql.end()
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      logger.error('Disabling the Tin projection failed', toError(error))
      process.exit(1)
    }
  )
}
