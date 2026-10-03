import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import { escapeRegExp } from '@sim/utils/string'
import type { Sql } from 'postgres'

const logger = createLogger('SearchRetirementMaintenance')
const MAINTENANCE_LOCK = 'sim:search-retirement-maintenance'
const VACUUM_TABLES = [
  'embedding_search',
  'embedding_keyword_search',
  'embedding_keyword_tin',
  'embedding_secret_provenance',
  'embedding',
  'document',
] as const

/**
 * Runs after retirement, including on databases that already journaled 0027. Concurrent rebuilds
 * and vacuum must run outside transactions; checkpoints follow each successful operation.
 */
export const maintainSearchRetirementMigration: ScriptMigration = {
  name: '0028_maintain_search_retirement',
  async up(sql) {
    const [table] = await sql`SELECT to_regclass('search_embedding_cleanup_progress') AS relation`
    if (!table.relation) return
    const [retirement] = await sql`SELECT phase FROM search_embedding_cleanup_progress WHERE id = 1`
    if (!retirement) return
    if (retirement.phase !== 'done')
      throw new Error('Search retirement must finish before maintenance')

    const [{ locked }] =
      await sql`SELECT pg_try_advisory_lock(hashtextextended(${MAINTENANCE_LOCK}, 0)) AS locked`
    if (!locked) throw new Error('Search retirement maintenance is already running')
    const [settings] = await sql`SELECT current_setting('statement_timeout') AS statement_timeout,
      current_setting('lock_timeout') AS lock_timeout`
    try {
      await sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '1s'`
        await tx`SET LOCAL statement_timeout = '120s'`
        await tx`ALTER TABLE search_embedding_cleanup_progress
          ADD COLUMN IF NOT EXISTS reindexed_through text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS vacuumed_tables integer NOT NULL DEFAULT 0`
      })
      /** Concurrent maintenance waits for old snapshots without blocking ordinary table writes. */
      await sql`SET statement_timeout = 0`
      await sql`SET lock_timeout = 0`
      for (;;) {
        const [index] = await sql<{ name: string; qualified_name: string }[]>`
          SELECT c.relname::text AS name, format('%I.%I', n.nspname, c.relname) AS qualified_name
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_am am ON am.oid = c.relam
          WHERE i.indrelid = to_regclass('embedding_search') AND am.amname = 'hnsw'
            AND c.relname::text > (SELECT reindexed_through FROM search_embedding_cleanup_progress WHERE id = 1)
            AND c.relname !~ '_cc(new|old)[0-9]*$'
          ORDER BY c.relname::text LIMIT 1`
        if (!index) break
        await removeInterruptedRebuilds(sql, index.name)
        const startedAt = Date.now()
        logger.info('Rebuilding retired Search vector index', { index: index.name })
        await sql.unsafe(`REINDEX INDEX CONCURRENTLY ${index.qualified_name}`)
        await sql`UPDATE search_embedding_cleanup_progress SET reindexed_through = ${index.name} WHERE id = 1`
        logger.info('Search vector index rebuilt', {
          index: index.name,
          elapsedMs: Date.now() - startedAt,
        })
      }

      const [progress] = await sql<{ vacuumed_tables: number }[]>`
        SELECT vacuumed_tables FROM search_embedding_cleanup_progress WHERE id = 1`
      for (let step = progress.vacuumed_tables; step < VACUUM_TABLES.length; step++) {
        const tableName = VACUUM_TABLES[step]
        const [relation] = await sql<{ qualified_name: string; can_maintain: boolean }[]>`
          SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name,
            CASE WHEN current_setting('server_version_num')::int >= 170000
              THEN has_table_privilege(c.oid, 'MAINTAIN')
              ELSE pg_has_role(c.relowner, 'USAGE') END AS can_maintain
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.oid = to_regclass(${tableName})`
        if (!relation?.can_maintain) throw new Error(`Cannot vacuum retirement table ${tableName}`)
        const startedAt = Date.now()
        logger.info('Vacuuming retired Search storage', { table: tableName })
        await sql.unsafe(`VACUUM (ANALYZE, TRUNCATE FALSE) ${relation.qualified_name}`)
        await sql`UPDATE search_embedding_cleanup_progress SET vacuumed_tables = ${step + 1} WHERE id = 1`
        logger.info('Search storage vacuumed', {
          table: tableName,
          elapsedMs: Date.now() - startedAt,
        })
      }
    } finally {
      try {
        await sql`SELECT set_config('statement_timeout', ${settings.statement_timeout}, false),
          set_config('lock_timeout', ${settings.lock_timeout}, false)`
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtextextended(${MAINTENANCE_LOCK}, 0))`
      }
    }
  },
}

/** PostgreSQL leaves invalid _ccnew/_ccold siblings if a concurrent rebuild is interrupted. */
async function removeInterruptedRebuilds(sql: Sql, indexName: string): Promise<void> {
  for (;;) {
    const [leftover] = await sql<{ qualified_name: string }[]>`
      SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_am am ON am.oid = c.relam
      WHERE i.indrelid = to_regclass('embedding_search') AND am.amname = 'hnsw'
        AND NOT i.indisvalid AND c.relname ~ ${`^${escapeRegExp(indexName)}_cc(new|old)[0-9]*$`}
      ORDER BY c.relname LIMIT 1`
    if (!leftover) return
    await sql.unsafe(`DROP INDEX CONCURRENTLY ${leftover.qualified_name}`)
  }
}
