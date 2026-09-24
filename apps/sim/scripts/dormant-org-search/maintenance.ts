#!/usr/bin/env bun

/**
 * Post-deletion maintenance for the knowledge search tables: a health report, `REINDEX INDEX
 * CONCURRENTLY` of the indexes the deletion left mostly dead, and a manual `VACUUM (VERBOSE,
 * ANALYZE)` one table at a time.
 *
 * Reindex before vacuuming: vacuuming an HNSW index repairs the graph around every deleted element,
 * which can keep autovacuum on a heavily deleted `embedding_search` running for a very long time,
 * while a concurrent reindex builds a fresh graph from the live rows only and leaves the vacuum
 * almost nothing to repair.
 *
 * Usage:
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/maintenance.ts                     # report only
 *   ... maintenance.ts --reindex=embedding_search_512_cosine_hnsw_idx                                          # dry run: prints the plan
 *   ... maintenance.ts --reindex=embedding_search_512_cosine_hnsw_idx --execute [--maintenance-work-mem=4GB]
 *   ... maintenance.ts --reindex=all --execute
 *   ... maintenance.ts --vacuum=embedding_search --execute [--maintenance-work-mem=1GB]
 *
 * Exit codes: 0 done, 1 failed or refused.
 */

import { parseArgs } from 'node:util'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { Sql } from 'postgres'
import {
  connectMigrationRole,
  parsePositiveInteger,
  resolveExecuteFlag,
} from '@/scripts/dormant-org-search/cli'

const logger = createLogger('DormantOrgSearchMaintenance')

/**
 * The indexes a search index deletion leaves mostly dead, in the order to rebuild them: the vector
 * index search walks first, then the keyword and lookup indexes. `--reindex=all` rebuilds these;
 * any other index of a {@link VACUUM_TARGETS} table can be named explicitly.
 */
export const REINDEX_TARGETS = [
  'embedding_search_512_cosine_hnsw_idx',
  'embedding_search_acl_unfilled_idx',
  'embedding_keyword_search_content_idx',
  'emb_content_fts_idx',
  'embedding_search_document_lookup_idx',
] as const

/** The tables the deletion wrote dead tuples into, largest first. */
export const VACUUM_TARGETS = [
  'embedding_search',
  'embedding',
  'embedding_keyword_search',
  'embedding_secret_provenance',
  'document',
  'knowledge_document_observation',
  'document_secret_provenance',
  'embedding_keyword_tin',
] as const

/** Tables the report covers. */
const REPORT_TABLES = [...VACUUM_TARGETS, 'knowledge_projection_dirty', 'outbox_event'] as const

/** Accepts `1GB`, `512MB` and the like, the only shapes interpolated into `SET`. */
const MEMORY_SETTING = /^[1-9][0-9]{0,5}(kB|MB|GB)$/

/** An unquoted lower-case identifier, the only index name shape interpolated into `REINDEX`. */
const INDEX_NAME = /^[a-z_][a-z0-9_]{0,62}$/

export type MaintenanceAction =
  | { kind: 'report' }
  | { kind: 'reindex'; indexes: string[] }
  | { kind: 'vacuum'; table: string }

export interface MaintenancePlan {
  action: MaintenanceAction
  /** Session settings applied before the statements. */
  settings: string[]
  statements: string[]
}

/**
 * Validates targets and renders the statements: a table must be listed, and an index name must be
 * a plain identifier, which {@link runMaintenance} then checks belongs to a listed table before
 * anything runs. A vacuum takes exactly one table: running two at once doubles the I/O and memory
 * the database has to absorb.
 */
export function planMaintenance(input: {
  reindex?: string
  vacuum?: string
  maintenanceWorkMem?: string
  parallelWorkers?: number
}): MaintenancePlan {
  if (input.reindex && input.vacuum) throw new Error('Pass --reindex or --vacuum, not both')
  if (input.maintenanceWorkMem && !MEMORY_SETTING.test(input.maintenanceWorkMem)) {
    throw new Error(
      `--maintenance-work-mem must look like 1GB or 512MB, got ${input.maintenanceWorkMem}`
    )
  }
  /**
   * `REINDEX CONCURRENTLY` and `VACUUM` wait for older transactions; a lock or statement timeout
   * would cancel them partway, and a cancelled concurrent reindex leaves an invalid copy behind.
   */
  const settings = [
    'SET lock_timeout = 0',
    'SET statement_timeout = 0',
    ...(input.maintenanceWorkMem
      ? [`SET maintenance_work_mem = '${input.maintenanceWorkMem}'`]
      : []),
    ...(input.parallelWorkers !== undefined
      ? [`SET max_parallel_maintenance_workers = ${input.parallelWorkers}`]
      : []),
  ]
  if (input.reindex) {
    const requested =
      input.reindex === 'all'
        ? [...REINDEX_TARGETS]
        : input.reindex.split(',').map((name) => name.trim())
    const malformed = requested.filter((name) => !INDEX_NAME.test(name))
    if (malformed.length > 0) throw new Error(`Not an index name: ${malformed.join(', ')}`)
    return {
      action: { kind: 'reindex', indexes: requested },
      settings,
      statements: requested.map((name) => `REINDEX INDEX CONCURRENTLY ${name}`),
    }
  }
  if (input.vacuum) {
    if (!(VACUUM_TARGETS as readonly string[]).includes(input.vacuum)) {
      throw new Error(
        `Not a maintenance table: ${input.vacuum}; expected one of ${VACUUM_TARGETS.join(', ')}`
      )
    }
    return {
      action: { kind: 'vacuum', table: input.vacuum },
      settings,
      statements: [`VACUUM (VERBOSE, ANALYZE) ${input.vacuum}`],
    }
  }
  return { action: { kind: 'report' }, settings: [], statements: [] }
}

export interface MaintenanceDatabase {
  report(): Promise<Record<string, unknown>>
  /** The table an index belongs to, or `null` when no such index exists. */
  indexTable(index: string): Promise<string | null>
  /** Invalid leftovers of an interrupted concurrent reindex of `index` (`<index>_ccnew`, `_ccnew1`, ...). */
  invalidReindexLeftovers(index: string): Promise<string[]>
  run(statement: string): Promise<void>
}

/**
 * Prints the report, and when `execute` is set runs the plan: each reindex first drops any invalid
 * copy an interrupted run left, which would otherwise be maintained on every write while serving
 * no query. The report is printed again at the end.
 */
export async function runMaintenance(
  database: MaintenanceDatabase,
  plan: MaintenancePlan,
  options: { execute: boolean }
): Promise<{ executed: string[] }> {
  logger.info('Knowledge search tables before maintenance', await database.report())
  if (plan.action.kind === 'report') return { executed: [] }
  if (plan.action.kind === 'reindex') {
    for (const index of plan.action.indexes) {
      const table = await database.indexTable(index)
      if (!table || !(VACUUM_TARGETS as readonly string[]).includes(table)) {
        throw new Error(
          `Not a maintenance index: ${index}; expected an index of ${VACUUM_TARGETS.join(', ')}`
        )
      }
    }
  }
  if (!options.execute) {
    logger.info('Dry run: would run', { settings: plan.settings, statements: plan.statements })
    return { executed: [] }
  }
  const executed: string[] = []
  for (const setting of plan.settings) await database.run(setting)
  for (const [position, statement] of plan.statements.entries()) {
    if (plan.action.kind === 'reindex') {
      const index = plan.action.indexes[position]
      for (const leftover of await database.invalidReindexLeftovers(index)) {
        const drop = `DROP INDEX CONCURRENTLY IF EXISTS ${leftover}`
        logger.warn('Dropping an invalid index left by an interrupted reindex', { leftover })
        await database.run(drop)
        executed.push(drop)
      }
    }
    const startedAt = Date.now()
    logger.info('Running', { statement })
    await database.run(statement)
    executed.push(statement)
    logger.info('Finished', { statement, elapsedMs: Date.now() - startedAt })
  }
  logger.info('Knowledge search tables after maintenance', await database.report())
  return { executed }
}

/** The postgres.js implementation on one reserved session, so `SET` applies to what follows it. */
export function postgresMaintenanceDatabase(sql: Sql): MaintenanceDatabase {
  return {
    async report() {
      const tables = await sql`
        SELECT s.relname AS table, s.n_live_tup AS live_rows, s.n_dead_tup AS dead_rows,
          pg_size_pretty(pg_total_relation_size(s.relid)) AS total_size,
          s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
        FROM pg_stat_user_tables s
        WHERE s.relname IN ${sql([...REPORT_TABLES])}
        ORDER BY pg_total_relation_size(s.relid) DESC`
      const indexes = await sql`
        SELECT c.relname AS index, t.relname AS table, pg_size_pretty(pg_relation_size(c.oid)) AS size,
          i.indisvalid AS valid
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE t.relname IN ${sql([...REPORT_TABLES])}
          AND (c.relname IN ${sql([...REINDEX_TARGETS])} OR c.relname LIKE '%hnsw%'
            OR c.relname LIKE '%ccnew%' OR NOT i.indisvalid)
        ORDER BY pg_relation_size(c.oid) DESC`
      const vacuums = await sql`
        SELECT p.pid, c.relname AS table, p.phase, p.heap_blks_total, p.heap_blks_scanned,
          p.index_vacuum_count, now() - a.xact_start AS running_for
        FROM pg_stat_progress_vacuum p
        JOIN pg_class c ON c.oid = p.relid
        LEFT JOIN pg_stat_activity a ON a.pid = p.pid`
      const builds = await sql`
        SELECT p.pid, c.relname AS index, p.phase, p.blocks_total, p.blocks_done,
          p.tuples_total, p.tuples_done
        FROM pg_stat_progress_create_index p
        LEFT JOIN pg_class c ON c.oid = p.index_relid`
      return { tables, indexes, vacuums, builds }
    },
    async indexTable(index) {
      const [row] = await sql<Array<{ table: string }>>`
        SELECT t.relname AS table
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = ${index} AND n.nspname = current_schema()`
      return row?.table ?? null
    },
    async invalidReindexLeftovers(index) {
      const rows = await sql<Array<{ name: string }>>`
        SELECT c.relname AS name
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE NOT i.indisvalid AND c.relname ~ ${`^${index}_ccnew[0-9]*$`}`
      return rows.map((row) => row.name)
    },
    async run(statement) {
      await sql.unsafe(statement)
    },
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      reindex: { type: 'string' },
      vacuum: { type: 'string' },
      'maintenance-work-mem': { type: 'string' },
      'parallel-workers': { type: 'string' },
    },
    strict: true,
  })
  const execute = resolveExecuteFlag(values)
  const plan = planMaintenance({
    reindex: values.reindex,
    vacuum: values.vacuum,
    maintenanceWorkMem: values['maintenance-work-mem'],
    parallelWorkers:
      values['parallel-workers'] === undefined
        ? undefined
        : parsePositiveInteger('parallel-workers', values['parallel-workers'], 1),
  })
  const sql = connectMigrationRole()
  try {
    await runMaintenance(postgresMaintenanceDatabase(sql), plan, { execute })
  } finally {
    await sql.end()
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      logger.error('Maintenance failed', toError(error))
      process.exit(1)
    }
  )
}
