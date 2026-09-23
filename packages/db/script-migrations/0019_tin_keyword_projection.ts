import { EMBEDDING_KEYWORD_TIN_INDEX } from '@sim/db/schema'
import { type ScriptMigration, ScriptMigrationDeferred } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('TinKeywordProjection')
const BATCH_SIZE = 500

/** Refusals that mean this database cannot host Tin, as opposed to a failed installation. */
const EXTENSION_REFUSED_CODES = new Set(['42501', '0A000'])

/**
 * Installs the extension, or reports that this database refuses it: listed as available is not
 * the same as creatable by the migration role. Tin is an optimization, so a refusal leaves keyword
 * search on the GIN projection instead of failing the deploy, and defers the migration so the
 * upgrade after the extension is allowed installs it.
 */
async function createTinExtension(sql: Sql): Promise<boolean> {
  try {
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS tin')
    return true
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (typeof code !== 'string' || !EXTENSION_REFUSED_CODES.has(code)) throw error
    logger.warn('The database refused the tin extension; keyword search keeps the GIN projection', {
      code,
    })
    return false
  }
}

/**
 * Whether the database offers the `tin` extension. Only PlanetScale Postgres ships it; everywhere
 * else the projection table stays empty and keyword search keeps the GIN projection.
 */
async function tinAvailable(sql: Sql): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM pg_available_extensions WHERE name = 'tin'`
  return rows.length > 0
}

/**
 * Installs the stream and base-token functions shared by the triggers and the query path, and the
 * embedding and knowledge base triggers, atomically with respect to embedding writers.
 *
 * `knowledge_tin_stream` emits a tsvector's lexemes in position order, so Tin ranks exactly the
 * `english` analysis the GIN projection stores. Stopwords the analysis dropped leave no gap, so a
 * phrase also matches across them, slightly looser than the GIN projection's positional match.
 * `knowledge_tin_base_token` names a knowledge base as one indexed term, so a query ranks within one
 * base inside the index. Only organization search indexes are projected: they are the bases large
 * enough for a member to reach more than an exact ranking can afford, where GIN keyword ranking has
 * to score every match before access is checked.
 *
 * Membership follows `knowledge_base.is_search_index`, so the projection has two writers: the
 * embedding trigger projects one chunk, and the knowledge base trigger projects or removes a whole
 * base when a legacy base is adopted as a search index. They serialize on a transaction advisory
 * lock per base, taken before the marker is read: embedding writers share it, so they never wait on
 * each other, and a marker change takes it exclusively, so it waits for writers already in flight
 * and later writers wait for it. Each then reads under a fresh snapshot, so neither misses the
 * other's rows. A row lock cannot do this: a key-share lock on the marker row is compatible with
 * the uncommitted marker update, so a writer would read the old marker without waiting. A whole
 * base is reached through `embedding`'s knowledge base index, since a projected row always carries
 * its chunk's base and the projection keeps no index but Tin's.
 */
export async function installProjection(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe('LOCK TABLE embedding IN SHARE ROW EXCLUSIVE MODE')
    await tx.unsafe(`CREATE OR REPLACE FUNCTION knowledge_tin_stream(vector tsvector)
      RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT coalesce(string_agg(entry.lexeme, ' ' ORDER BY position), '')
        FROM unnest(vector) AS entry(lexeme, positions, weights), unnest(entry.positions) AS position
      $$`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION knowledge_tin_base_token(knowledge_base_id text)
      RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT 'zkb' || md5(knowledge_base_id)
      $$`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION knowledge_tin_membership_key(knowledge_base_id text)
      RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT hashtextextended('embedding_keyword_tin:' || knowledge_base_id, 0)
      $$`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_keyword_tin()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock_shared(knowledge_tin_membership_key(NEW.knowledge_base_id));
        IF NOT EXISTS (
          SELECT 1 FROM knowledge_base WHERE id = NEW.knowledge_base_id AND is_search_index
        ) THEN
          DELETE FROM embedding_keyword_tin WHERE id = NEW.id;
          RETURN NEW;
        END IF;
        INSERT INTO embedding_keyword_tin (id, knowledge_base_id, document_id, enabled, content)
        VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled,
          knowledge_tin_base_token(NEW.knowledge_base_id) || ' ' || knowledge_tin_stream(NEW.content_tsv))
        ON CONFLICT (id) DO UPDATE SET
          knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
          enabled = EXCLUDED.enabled, content = EXCLUDED.content;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_keyword_tin_sync
      AFTER INSERT OR UPDATE OF knowledge_base_id, document_id, enabled, content ON embedding
      FOR EACH ROW EXECUTE FUNCTION sync_embedding_keyword_tin()`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_knowledge_base_keyword_tin()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(knowledge_tin_membership_key(NEW.id));
        IF NOT NEW.is_search_index THEN
          DELETE FROM embedding_keyword_tin t USING embedding e
          WHERE e.knowledge_base_id = NEW.id AND t.id = e.id;
          RETURN NEW;
        END IF;
        INSERT INTO embedding_keyword_tin (id, knowledge_base_id, document_id, enabled, content)
        SELECT id, knowledge_base_id, document_id, enabled,
          knowledge_tin_base_token(knowledge_base_id) || ' ' || knowledge_tin_stream(content_tsv)
        FROM embedding WHERE knowledge_base_id = NEW.id
        ON CONFLICT (id) DO UPDATE SET
          knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
          enabled = EXCLUDED.enabled, content = EXCLUDED.content;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER knowledge_base_keyword_tin_sync
      AFTER UPDATE OF is_search_index ON knowledge_base
      FOR EACH ROW WHEN (OLD.is_search_index IS DISTINCT FROM NEW.is_search_index)
      EXECUTE FUNCTION sync_knowledge_base_keyword_tin()`)
  })
}

/**
 * Fills rows the trigger has not written yet, in independently committed keyset pages. Each page
 * takes the membership locks of its bases before reading them, as the embedding trigger does, and
 * then reads under a fresh snapshot: a base whose search-index marker is changing is read only
 * after that change commits, so the backfill never writes back a chunk the change removed.
 */
export async function backfillProjection(sql: Sql): Promise<number> {
  let afterId = ''
  let inserted = 0
  let scanned = 0
  const startedAt = Date.now()
  for (;;) {
    const page = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      const rows = await tx<Array<{ id: string; knowledge_base_id: string }>>`
        SELECT id, knowledge_base_id FROM embedding WHERE id > ${afterId} ORDER BY id
        LIMIT ${BATCH_SIZE}`
      if (rows.length === 0) return null
      const ids = rows.map((row) => row.id)
      const bases = [...new Set(rows.map((row) => row.knowledge_base_id))]
      await tx`SELECT pg_advisory_xact_lock_shared(knowledge_tin_membership_key(base))
        FROM unnest(${bases}::text[]) AS base ORDER BY base`
      const [{ written }] = await tx<Array<{ written: number }>>`
        WITH batch AS MATERIALIZED (
          SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled, e.content_tsv
          FROM embedding e
          INNER JOIN knowledge_base k ON k.id = e.knowledge_base_id AND k.is_search_index
          WHERE e.id = ANY(${ids}::text[])
            AND NOT EXISTS (SELECT 1 FROM embedding_keyword_tin t WHERE t.id = e.id)
          ORDER BY e.id FOR KEY SHARE OF e
        ), written AS (
          INSERT INTO embedding_keyword_tin (id, knowledge_base_id, document_id, enabled, content)
          SELECT id, knowledge_base_id, document_id, enabled,
            knowledge_tin_base_token(knowledge_base_id) || ' ' || knowledge_tin_stream(content_tsv)
          FROM batch
          ON CONFLICT (id) DO NOTHING RETURNING id
        ) SELECT count(*)::int AS written FROM written`
      return { afterId: ids[ids.length - 1], scanned: ids.length, inserted: written }
    })
    if (!page) break
    afterId = page.afterId
    inserted += page.inserted
    scanned += page.scanned
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Tin keyword backfill progress', {
        scanned,
        inserted,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  await sql.unsafe('VACUUM (ANALYZE) embedding_keyword_tin')
  return inserted
}

/**
 * Builds the Tin index after the bulk load, concurrently so the trigger keeps writing. An
 * interrupted build leaves an invalid index, which is dropped and rebuilt; a valid one is kept.
 */
async function buildProjectionIndex(sql: Sql): Promise<void> {
  const [{ timeout }] = await sql`SELECT current_setting('lock_timeout') AS timeout`
  await sql.unsafe('SET lock_timeout = 0')
  try {
    const [existing] = await sql`SELECT i.indisvalid FROM pg_index i
      WHERE i.indexrelid = to_regclass(${EMBEDDING_KEYWORD_TIN_INDEX})`
    if (existing?.indisvalid) return
    if (existing) await sql.unsafe(`DROP INDEX CONCURRENTLY ${EMBEDDING_KEYWORD_TIN_INDEX}`)
    const startedAt = Date.now()
    logger.info('Building Tin keyword index', { index: EMBEDDING_KEYWORD_TIN_INDEX })
    await sql.unsafe(
      `CREATE INDEX CONCURRENTLY ${EMBEDDING_KEYWORD_TIN_INDEX} ON embedding_keyword_tin USING tin (content) WITH (tokenizer = 'whitespace')`
    )
    logger.info('Tin keyword index built', {
      index: EMBEDDING_KEYWORD_TIN_INDEX,
      elapsedMs: Date.now() - startedAt,
    })
  } finally {
    await sql`SELECT set_config('lock_timeout', ${timeout}, false)`
  }
}

/**
 * Installs and fills the Tin keyword projection where the database offers `tin`, and records a
 * no-op elsewhere. A database that refuses the extension it offers defers instead, so a later
 * upgrade retries it. A database that gains the extension after recording the no-op runs this file
 * directly (see below) to adopt it; the whole migration is idempotent.
 */
export async function installTinKeywordProjection(sql: Sql): Promise<void> {
  if (!(await tinAvailable(sql))) {
    logger.info('Tin is unavailable; keyword search keeps the GIN projection')
    return
  }
  if (!(await createTinExtension(sql))) {
    throw new ScriptMigrationDeferred('the database refused the tin extension')
  }
  await installProjection(sql)
  const rows = await backfillProjection(sql)
  await buildProjectionIndex(sql)
  logger.info('Tin keyword projection initialized', { rows })
}

export const tinKeywordProjectionMigration: ScriptMigration = {
  name: '0019_tin_keyword_projection',
  up: installTinKeywordProjection,
}

/**
 * Installs the projection where this database allows it, treating a refused extension as a no-op:
 * run directly — `db:push`, or adopting Tin after a cluster gains it — there is no migration
 * record to leave unwritten, and keyword search keeps the GIN projection either way.
 */
export async function adoptTinKeywordProjection(sql: Sql): Promise<void> {
  try {
    await installTinKeywordProjection(sql)
  } catch (error) {
    if (!(error instanceof ScriptMigrationDeferred)) throw error
    logger.warn('Tin projection deferred; keyword search keeps the GIN projection', {
      reason: error.message,
    })
  }
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to install the Tin keyword projection')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await adoptTinKeywordProjection(sql)
  } finally {
    await sql.end()
  }
}
