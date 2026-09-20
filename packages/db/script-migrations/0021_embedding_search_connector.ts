import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('EmbeddingSearchConnector')

/** Chunks backfilled per statement; each batch commits on its own. */
const BATCH_SIZE = 20_000

/**
 * Carries a chunk's source onto the vector projection and keeps it there.
 *
 * The projection trigger reads it from the chunk's document on every write, and a document that
 * changes hands — a connector rewrite, a restore — fans the new source out to its chunks. Both are
 * primary-key lookups, so the cost is a fixed addition to a write that already touches the row.
 */
export async function installEmbeddingSearchConnector(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_search_connector()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE embedding_search SET connector_id = NEW.connector_id
        WHERE document_id = NEW.id AND connector_id IS DISTINCT FROM NEW.connector_id;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_search_connector_sync
      AFTER INSERT OR UPDATE OF connector_id ON document
      FOR EACH ROW EXECUTE FUNCTION sync_embedding_search_connector()`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION set_embedding_search_connector()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        SELECT connector_id INTO NEW.connector_id FROM document WHERE id = NEW.document_id;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_search_connector_set
      BEFORE INSERT OR UPDATE OF document_id ON embedding_search
      FOR EACH ROW EXECUTE FUNCTION set_embedding_search_connector()`)
  })
}

/** Fills the column for chunks written before the trigger existed. Keyset batched and idempotent. */
export async function backfillEmbeddingSearchConnector(sql: Sql): Promise<void> {
  const startedAt = Date.now()
  let after = ''
  let written = 0
  for (;;) {
    const rows = await sql<{ id: string }[]>`
      WITH page AS (
        SELECT s.id, d.connector_id
        FROM embedding_search s
        JOIN document d ON d.id = s.document_id
        WHERE s.id > ${after} AND s.connector_id IS NULL AND d.connector_id IS NOT NULL
        ORDER BY s.id
        LIMIT ${BATCH_SIZE}
      ), updated AS (
        UPDATE embedding_search s SET connector_id = page.connector_id
        FROM page WHERE s.id = page.id AND s.connector_id IS NULL
        RETURNING s.id
      )
      SELECT id FROM page ORDER BY id`
    if (rows.length === 0) break
    after = rows[rows.length - 1].id
    written += rows.length
    if (written % (BATCH_SIZE * 10) === 0) {
      logger.info('Embedding search connector backfill progress', { scanned: written })
    }
  }
  logger.info('Embedding search connector backfilled', {
    scanned: written,
    elapsedMs: Date.now() - startedAt,
  })
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
