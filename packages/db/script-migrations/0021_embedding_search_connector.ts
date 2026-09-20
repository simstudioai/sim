import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('ProjectionSourceAcl')

/** Chunks read per page; each page commits on its own, as the other projection backfills do. */
const BATCH_SIZE = 500

/** The projections that carry their document's source and ACL. */
const PROJECTIONS = ['embedding_search', 'embedding_keyword_tin'] as const
type Projection = (typeof PROJECTIONS)[number]

/**
 * Carries a chunk's source and ACL onto the ranking projections and keeps them there.
 *
 * Each projection's own trigger reads both from the chunk's document on every write, under a share
 * lock so a write and a document's change cannot interleave; a document that changes hands or whose
 * ACL is rewritten fans the new values out to the chunks a search can reach, which is what the
 * enabled-row lookup indexes cover. A disabled chunk takes both from its document again when it is
 * enabled, so it rejoins current rather than stale.
 *
 * With the source and ACL on the row, ranking decides readability on the row it scores — inside the
 * vector walk and inside the keyword window — instead of through a join per candidate. Hydration
 * still reads content under the full predicate.
 */
export async function installProjectionSourceAcl(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_projection_source_acl()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE embedding_search SET connector_id = NEW.connector_id, acl = NEW.acl
        WHERE document_id = NEW.id AND enabled
          AND (connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl);
        UPDATE embedding_keyword_tin SET connector_id = NEW.connector_id, acl = NEW.acl
        WHERE document_id = NEW.id AND enabled
          AND (connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl);
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER projection_source_acl_sync
      AFTER INSERT OR UPDATE OF connector_id, acl ON document
      FOR EACH ROW EXECUTE FUNCTION sync_projection_source_acl()`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION set_projection_source_acl()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        SELECT connector_id, acl INTO NEW.connector_id, NEW.acl FROM document
        WHERE id = NEW.document_id FOR SHARE;
        RETURN NEW;
      END;
      $$`)
    for (const projection of PROJECTIONS) {
      await tx.unsafe(`CREATE OR REPLACE TRIGGER ${projection}_source_acl_set
        BEFORE INSERT OR UPDATE OF document_id, enabled ON ${projection}
        FOR EACH ROW EXECUTE FUNCTION set_projection_source_acl()`)
    }
    /** The earlier shape of this migration, where the source alone was carried, and only on vectors. */
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_search_connector_sync ON document')
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_search_connector_set ON embedding_search')
    await tx.unsafe('DROP FUNCTION IF EXISTS sync_embedding_search_connector()')
    await tx.unsafe('DROP FUNCTION IF EXISTS set_embedding_search_connector()')
  })
}

/**
 * Fills a projection's source and ACL for chunks written before the trigger existed, in
 * independently committed keyset pages. Each page bounds its own locking and runtime and writes only
 * rows still unset, so an interrupted run resumes by rerunning and a row the trigger has since
 * written is left alone. The documents are share-locked before their values are copied, so a change
 * in flight waits for the page and then fans its own values out; and a chunk that moved to another
 * document meanwhile is left to that document's trigger, since the write requires the document the
 * values were read from.
 */
export async function backfillProjectionSourceAcl(
  sql: Sql,
  projection: Projection
): Promise<number> {
  const startedAt = Date.now()
  let afterId = ''
  let scanned = 0
  let written = 0
  for (;;) {
    const page = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      const rows = await tx.unsafe<Array<{ id: string }>>(
        `SELECT id FROM ${projection} WHERE id > $1 ORDER BY id LIMIT ${BATCH_SIZE}`,
        [afterId]
      )
      if (rows.length === 0) return null
      const ids = rows.map((row) => row.id)
      const [{ filled }] = await tx.unsafe<Array<{ filled: number }>>(
        `WITH page AS (
          SELECT s.id, s.document_id, d.connector_id, d.acl
          FROM ${projection} s JOIN document d ON d.id = s.document_id
          WHERE s.id = ANY($1::text[]) AND s.acl IS NULL
          FOR SHARE OF d
        ), updated AS (
          UPDATE ${projection} s SET connector_id = page.connector_id, acl = page.acl
          FROM page
          WHERE s.id = page.id AND s.document_id = page.document_id AND s.acl IS NULL
          RETURNING s.id
        ) SELECT count(*)::int AS filled FROM updated`,
        [ids]
      )
      return { afterId: ids[ids.length - 1], scanned: ids.length, filled }
    })
    if (!page) break
    afterId = page.afterId
    scanned += page.scanned
    written += page.filled
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Projection source and ACL backfill progress', {
        projection,
        scanned,
        written,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  logger.info('Projection source and ACL backfilled', {
    projection,
    scanned,
    written,
    elapsedMs: Date.now() - startedAt,
  })
  return written
}

/**
 * The indexes exact ranking of a readable set needs: the ACL index on each projection, and on the
 * vector projection the source index that lets the planner lead with a few sources when the
 * caller's tokens alone would match most of the index. Built after the bulk load and concurrently,
 * so the triggers keep writing. `CONCURRENTLY` cannot run in a transaction, and the pool's lock
 * timeout would cancel a build that merely waits for a long transaction to finish.
 */
export async function indexProjectionAcl(sql: Sql): Promise<void> {
  const [{ timeout }] = await sql`SELECT current_setting('lock_timeout') AS timeout`
  await sql.unsafe('SET lock_timeout = 0')
  try {
    const builds: Array<[name: string, definition: string]> = [
      ...PROJECTIONS.map((projection): [string, string] => [
        `${projection}_acl_gin_idx`,
        `ON ${projection} USING gin (acl) WHERE enabled`,
      ]),
      ['embedding_search_source_idx', 'ON embedding_search (connector_id) WHERE enabled'],
    ]
    for (const [name, definition] of builds) {
      /**
       * An interrupted concurrent build leaves an invalid index behind, and `IF NOT EXISTS` would
       * then keep it; only a leftover that cannot be used is dropped before building again.
       */
      const [leftover] = await sql<Array<{ invalid: boolean }>>`
        SELECT NOT i.indisvalid OR NOT i.indisready AS invalid
        FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = ${name}`
      if (leftover?.invalid) await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`)
      await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ${definition}`)
    }
    /** The new columns carry no statistics until analyzed; the reach and source predicates plan on them. */
    for (const projection of PROJECTIONS) await sql.unsafe(`ANALYZE ${projection}`)
  } finally {
    await sql`SELECT set_config('lock_timeout', ${timeout}, false)`
  }
}

export const embeddingSearchConnectorMigration: ScriptMigration = {
  name: '0021_embedding_search_connector',
  async up(sql) {
    await installProjectionSourceAcl(sql)
    for (const projection of PROJECTIONS) await backfillProjectionSourceAcl(sql, projection)
    await indexProjectionAcl(sql)
  },
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to backfill the projection source and ACL')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await embeddingSearchConnectorMigration.up(sql)
  } finally {
    await sql.end()
  }
}
