import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('UsageCostProjection')
const BATCH_SIZE = 500
const SEARCH_INDEX = 'embedding_search_document_lookup_idx'
const DIMENSIONS = [
  'billing_entity_type',
  'billing_entity_id',
  'billing_period_start',
  'billing_period_end',
  'user_id',
  'source',
  'usage_date',
  'shard',
]
const dimensionColumns = DIMENSIONS.join(', ')

function projectedRows(relation: string, sign: 1 | -1): string {
  return `SELECT billing_entity_type, billing_entity_id, billing_period_start,
    billing_period_end, user_id, source, created_at::date AS usage_date,
    (get_byte(decode(md5(id), 'hex'), 0) % 8)::smallint AS shard,
    ${sign} * cost AS cost, ${sign}::bigint AS entry_count
    FROM ${relation} WHERE cost_projected AND billing_entity_type IS NOT NULL`
}

/** One ordered update per affected bucket, including corrections and moves between buckets. */
function projectionFunction(operation: 'insert' | 'update' | 'delete'): string {
  const changes = [
    ...(operation === 'insert' ? [] : [projectedRows('old_rows', -1)]),
    ...(operation === 'delete' ? [] : [projectedRows('new_rows', 1)]),
  ].join(' UNION ALL ')
  return `CREATE OR REPLACE FUNCTION sync_usage_daily_cost_${operation}()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO usage_daily_cost (${dimensionColumns}, cost, entry_count)
      SELECT ${dimensionColumns}, sum(cost), sum(entry_count)
      FROM (${changes}) changes
      GROUP BY ${dimensionColumns}
      HAVING sum(cost) <> 0 OR sum(entry_count) <> 0
      ORDER BY ${dimensionColumns}
      ON CONFLICT (${dimensionColumns}) DO UPDATE
        SET cost = usage_daily_cost.cost + EXCLUDED.cost,
          entry_count = usage_daily_cost.entry_count + EXCLUDED.entry_count;
      DELETE FROM usage_daily_cost bucket
      USING (${changes}) changes
      WHERE bucket.entry_count = 0
        AND ${DIMENSIONS.map((column) => `bucket.${column} = changes.${column}`).join(' AND ')};
      RETURN NULL;
    END;
    $$`
}

/**
 * Captures old and new application writes before any backfill starts. Only an
 * AFTER trigger accounts rows: INSERT ... ON CONFLICT DO NOTHING must never
 * charge a discarded candidate. The marker and its cost change commit together.
 */
export async function installUsageCostProjection(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe("SET LOCAL statement_timeout = '60s'")
    await tx.unsafe('LOCK TABLE usage_log IN SHARE ROW EXCLUSIVE MODE')
    for (const operation of ['insert', 'update', 'delete'] as const) {
      await tx.unsafe(projectionFunction(operation))
      const references = [
        ...(operation === 'insert' ? [] : ['OLD TABLE AS old_rows']),
        ...(operation === 'delete' ? [] : ['NEW TABLE AS new_rows']),
      ].join(' ')
      await tx.unsafe(`CREATE OR REPLACE TRIGGER usage_daily_cost_${operation}
        AFTER ${operation.toUpperCase()} ON usage_log REFERENCING ${references}
        FOR EACH STATEMENT EXECUTE FUNCTION sync_usage_daily_cost_${operation}()`)
    }
    await tx.unsafe(`CREATE OR REPLACE FUNCTION truncate_usage_daily_cost()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        TRUNCATE usage_daily_cost;
        RETURN NULL;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER usage_daily_cost_truncate
      AFTER TRUNCATE ON usage_log
      FOR EACH STATEMENT EXECUTE FUNCTION truncate_usage_daily_cost()`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION mark_usage_cost_projected()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.cost_projected := true;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER usage_cost_projected
      BEFORE INSERT OR UPDATE ON usage_log
      FOR EACH ROW EXECUTE FUNCTION mark_usage_cost_projected()`)
  })
}

/**
 * Accounts historical rows in independently committed primary-key pages. A
 * concurrent writer either projects the row first or waits for its row lock;
 * both paths preserve exact totals without a long-lived snapshot or table lock.
 */
export async function backfillUsageDailyCost(sql: Sql): Promise<number> {
  let afterId = ''
  let projected = 0
  let scanned = 0
  const startedAt = Date.now()
  for (;;) {
    const [page] = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      return tx<Array<{ after_id: string | null; scanned: number; projected: number }>>`
        WITH page AS MATERIALIZED (
          SELECT id FROM usage_log WHERE id > ${afterId} ORDER BY id LIMIT ${BATCH_SIZE}
        ), projected AS (
          UPDATE usage_log SET cost_projected = true
          FROM page WHERE usage_log.id = page.id AND NOT usage_log.cost_projected
          RETURNING usage_log.id
        )
        SELECT max(id) AS after_id, count(*)::int AS scanned,
          (SELECT count(*)::int FROM projected) AS projected FROM page
      `
    })
    if (!page.after_id) break
    afterId = page.after_id
    projected += page.projected
    scanned += page.scanned
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Usage cost backfill progress', {
        scanned,
        projected,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  const [{ incomplete }] = await sql`
    SELECT EXISTS (SELECT 1 FROM usage_log WHERE NOT cost_projected) AS incomplete
  `
  if (incomplete) throw new Error('Usage cost backfill left unprojected ledger rows')
  await sql.unsafe('ANALYZE usage_daily_cost')
  return projected
}

/** Reuses valid builds and repairs a CONCURRENTLY build interrupted before it became usable. */
export async function buildSearchDocumentLookupIndex(sql: Sql): Promise<void> {
  const [existing] = await sql`
    SELECT i.indisvalid, format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.indrelid = 'embedding_search'::regclass AND c.relname = ${SEARCH_INDEX}
  `
  if (existing?.indisvalid) return
  const [{ timeout }] = await sql`SELECT current_setting('lock_timeout') AS timeout`
  await sql.unsafe('SET lock_timeout = 0')
  try {
    if (existing) await sql.unsafe(`DROP INDEX CONCURRENTLY ${existing.qualified_name}`)
    const startedAt = Date.now()
    await sql.unsafe(`CREATE INDEX CONCURRENTLY ${SEARCH_INDEX}
      ON embedding_search (document_id, knowledge_base_id, id) WHERE enabled`)
    logger.info('Search document lookup index built', { elapsedMs: Date.now() - startedAt })
  } finally {
    await sql`SELECT set_config('lock_timeout', ${timeout}, false)`
  }
}

export const backfillUsageDailyCostMigration: ScriptMigration = {
  name: '0017_backfill_usage_daily_cost',
  async up(sql) {
    await installUsageCostProjection(sql)
    const rows = await backfillUsageDailyCost(sql)
    await buildSearchDocumentLookupIndex(sql)
    logger.info('Usage cost projection initialized', { rows })
  },
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to initialize usage cost projections')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await backfillUsageDailyCostMigration.up(sql)
  } finally {
    await sql.end()
  }
}
