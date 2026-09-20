import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('EmbeddingSearchConnector')

/** Chunks read per page; each page commits on its own, as the other projection backfills do. */
const BATCH_SIZE = 500

/**
 * Carries a chunk's source onto the vector projection and keeps it there.
 *
 * The projection trigger reads it from the chunk's document on every write, and a document that
 * changes hands — a connector rewrite, a restore — fans the new source out to its chunks. The fan
 * out touches only the chunks a search can reach, which is what the document lookup index covers;
 * a disabled chunk takes its source from its document again when it is enabled, so it rejoins
 * current rather than stale.
 */
export async function installEmbeddingSearchConnector(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_search_connector()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE embedding_search SET connector_id = NEW.connector_id
        WHERE document_id = NEW.id AND enabled
          AND connector_id IS DISTINCT FROM NEW.connector_id;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_search_connector_sync
      AFTER INSERT OR UPDATE OF connector_id ON document
      FOR EACH ROW EXECUTE FUNCTION sync_embedding_search_connector()`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION set_embedding_search_connector()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        SELECT connector_id INTO NEW.connector_id FROM document
        WHERE id = NEW.document_id FOR SHARE;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_search_connector_set
      BEFORE INSERT OR UPDATE OF document_id, enabled ON embedding_search
      FOR EACH ROW EXECUTE FUNCTION set_embedding_search_connector()`)
  })
}

/**
 * Fills the column for chunks written before the trigger existed, in independently committed
 * keyset pages. Each page bounds its own locking and runtime, and writes only rows still unset, so
 * an interrupted run resumes by rerunning and a row the trigger has since written is left alone.
 */
export async function backfillEmbeddingSearchConnector(sql: Sql): Promise<number> {
  const startedAt = Date.now()
  let afterId = ''
  let scanned = 0
  let written = 0
  for (;;) {
    const page = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      const rows = await tx<Array<{ id: string }>>`
        SELECT id FROM embedding_search WHERE id > ${afterId} ORDER BY id LIMIT ${BATCH_SIZE}`
      if (rows.length === 0) return null
      const ids = rows.map((row) => row.id)
      /**
       * The documents are share-locked before their source is copied, so a detachment in flight
       * waits for this page to commit and then fans its own change out through the trigger — the
       * chunk can never keep a source its document no longer has. A chunk that moved to another
       * document in the meantime is left to that document's trigger: the write requires the
       * document the source was read for.
       */
      const [{ filled }] = await tx<Array<{ filled: number }>>`
        WITH page AS (
          SELECT s.id, s.document_id, d.connector_id
          FROM embedding_search s JOIN document d ON d.id = s.document_id
          WHERE s.id = ANY(${ids}::text[])
            AND s.connector_id IS NULL AND d.connector_id IS NOT NULL
          FOR SHARE OF d
        ), updated AS (
          UPDATE embedding_search s SET connector_id = page.connector_id
          FROM page
          WHERE s.id = page.id AND s.document_id = page.document_id AND s.connector_id IS NULL
          RETURNING s.id
        ) SELECT count(*)::int AS filled FROM updated`
      return { afterId: ids[ids.length - 1], scanned: ids.length, filled }
    })
    if (!page) break
    afterId = page.afterId
    scanned += page.scanned
    written += page.filled
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Embedding search connector backfill progress', {
        scanned,
        written,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  logger.info('Embedding search connector backfilled', {
    scanned,
    written,
    elapsedMs: Date.now() - startedAt,
  })
  return written
}

export const embeddingSearchConnectorMigration: ScriptMigration = {
  name: '0021_embedding_search_connector',
  async up(sql) {
    await installEmbeddingSearchConnector(sql)
    await backfillEmbeddingSearchConnector(sql)
  },
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to backfill the projection source')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await embeddingSearchConnectorMigration.up(sql)
  } finally {
    await sql.end()
  }
}
