import { SYNCHRONOUS_PROJECTION_WHEN } from '@sim/db/knowledge-projection'
import postgres, { type Sql, type TransactionSql } from 'postgres'

/** The projections that carry their document's source and ACL. */
export const PROJECTION_SOURCE_ACL_TABLES = ['embedding_search', 'embedding_keyword_tin'] as const
export type ProjectionSourceAclTable = (typeof PROJECTION_SOURCE_ACL_TABLES)[number]

/**
 * The document trigger's fan-out: copies a document's source and ACL onto its enabled chunks.
 *
 * A chunk the source and ACL fill has not reached (`acl IS NULL`) keeps a NULL ACL. Search decides
 * such a row on its document, so writing the ACL there changes no answer, while every write to
 * `embedding_search` re-inserts the row into its vector index: a document whose ACL changed would
 * otherwise rewrite each of its unfilled chunks inside the writer's statement. A document that
 * moves to another source still carries the source onto its unfilled chunks, because source
 * filters read it from the row; an ACL change alone leaves them untouched. Expects `moved` in scope.
 */
export function projectionSourceAclFanOut(): string {
  return PROJECTION_SOURCE_ACL_TABLES.map(
    (projection) => `
      UPDATE ${projection}
      SET connector_id = NEW.connector_id, acl = CASE WHEN acl IS NULL THEN NULL ELSE NEW.acl END
      WHERE document_id = NEW.id AND enabled
        AND CASE WHEN acl IS NULL
          THEN moved AND connector_id IS DISTINCT FROM NEW.connector_id
          ELSE connector_id IS DISTINCT FROM NEW.connector_id OR acl IS DISTINCT FROM NEW.acl
        END;`
  ).join('')
}

/**
 * The document trigger's body as `0022` and `0023` install it: the fan-out alone. It depends on no
 * object a later migration creates, so every migration up to `0023` runs, and every write between
 * them succeeds, on its own. `0024_knowledge_projection_async` replaces it with the body that also
 * marks the document for the knowledge projector.
 */
export async function replaceProjectionSourceAclSync(sql: Sql | TransactionSql): Promise<void> {
  await sql.unsafe(`CREATE OR REPLACE FUNCTION sync_projection_source_acl()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      moved boolean := TG_OP = 'UPDATE' AND OLD.connector_id IS DISTINCT FROM NEW.connector_id;
    BEGIN${projectionSourceAclFanOut()}
      RETURN NEW;
    END;
    $$`)
}

/**
 * The projection triggers that copy a chunk's source and ACL from its document on every write,
 * skipped in the asynchronous mode, where the projector writes both itself.
 */
export async function installProjectionSourceAclSetTriggers(tx: TransactionSql): Promise<void> {
  for (const projection of PROJECTION_SOURCE_ACL_TABLES) {
    await tx.unsafe(`CREATE OR REPLACE TRIGGER ${projection}_source_acl_set
      BEFORE INSERT OR UPDATE OF document_id, enabled ON ${projection}
      FOR EACH ROW WHEN (${SYNCHRONOUS_PROJECTION_WHEN}) EXECUTE FUNCTION set_projection_source_acl()`)
  }
}

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
    await replaceProjectionSourceAclSync(tx)
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
    await installProjectionSourceAclSetTriggers(tx)
    /** The earlier shape of this migration, where the source alone was carried, and only on vectors. */
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_search_connector_sync ON document')
    await tx.unsafe('DROP TRIGGER IF EXISTS embedding_search_connector_set ON embedding_search')
    await tx.unsafe('DROP FUNCTION IF EXISTS sync_embedding_search_connector()')
    await tx.unsafe('DROP FUNCTION IF EXISTS set_embedding_search_connector()')
  })
}

/**
 * The indexes exact ranking of a readable set needs: the ACL index on each projection, and on the
 * vector projection the source index that lets the planner lead with a few sources when the
 * caller's tokens alone would match most of the index. Built concurrently, so the triggers and the
 * projector keep writing. `CONCURRENTLY` cannot run in a transaction, and the pool's lock timeout
 * would cancel a build that merely waits for a long transaction to finish. The timeout is a
 * session setting, so one connection is reserved for it, the builds, and the reset — a pool
 * would otherwise hand the builds to connections that never saw the setting.
 *
 * The unfilled index on each projection lists the rows the fill has not reached: the projector's
 * fill reads them from it instead of walking past every filled row, and the on-row predicate's
 * unfilled branch, an `OR` beside the ACL overlap, stays an index probe for the planner — once the
 * projection is filled, a probe of an empty index.
 */
export async function indexProjectionAcl(pool: Sql): Promise<void> {
  const sql = await pool.reserve()
  const [{ timeout }] = await sql`SELECT current_setting('lock_timeout') AS timeout`
  await sql.unsafe('SET lock_timeout = 0')
  try {
    const builds: Array<[name: string, definition: string]> = [
      ...PROJECTION_SOURCE_ACL_TABLES.flatMap(
        (projection): Array<[string, string]> => [
          [`${projection}_acl_gin_idx`, `ON ${projection} USING gin (acl) WHERE enabled`],
          [`${projection}_acl_unfilled_idx`, `ON ${projection} (id) WHERE acl IS NULL`],
        ]
      ),
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
    for (const projection of PROJECTION_SOURCE_ACL_TABLES) await sql.unsafe(`ANALYZE ${projection}`)
  } finally {
    await sql`SELECT set_config('lock_timeout', ${timeout}, false)`
    sql.release()
  }
}

/**
 * Run directly — `db:push`, or an operator repairing a database by hand — the triggers and indexes
 * are installed here; rows they have not filled are marked and filled by the knowledge projector.
 * The registered migration is `0022_projection_source_acl_backfill`.
 */
if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to install the projection source and ACL')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await installProjectionSourceAcl(sql)
    await indexProjectionAcl(sql)
  } finally {
    await sql.end()
  }
}
