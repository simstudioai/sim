import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('EmbeddingSearchProjection')
const BATCH_SIZE = 500

/** Installs synchronous maintenance before backfilling independently committed identifier pages. */
export async function backfillEmbeddingSearch(sql: Sql): Promise<number> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe('LOCK TABLE embedding IN SHARE ROW EXCLUSIVE MODE')
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_search()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO embedding_search
          (id, knowledge_base_id, document_id, enabled, "binary", binary_384, binary_768, binary_1024, binary_3072)
        VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled,
          binary_quantize(NEW.embedding)::bit(1536), binary_quantize(NEW.embedding_384)::bit(384),
          binary_quantize(NEW.embedding_768)::bit(768), binary_quantize(NEW.embedding_1024)::bit(1024),
          binary_quantize(NEW.embedding_3072)::bit(3072))
        ON CONFLICT (id) DO UPDATE SET
          knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
          enabled = EXCLUDED.enabled, "binary" = EXCLUDED."binary", binary_384 = EXCLUDED.binary_384,
          binary_768 = EXCLUDED.binary_768, binary_1024 = EXCLUDED.binary_1024,
          binary_3072 = EXCLUDED.binary_3072;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_search_sync
      AFTER INSERT OR UPDATE OF knowledge_base_id, document_id, enabled,
        embedding, embedding_384, embedding_768, embedding_1024, embedding_3072 ON embedding
      FOR EACH ROW EXECUTE FUNCTION sync_embedding_search()`)
  })

  let afterId = ''
  let count = 0
  let scanned = 0
  const startedAt = Date.now()
  for (;;) {
    const [page] = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      /** Key-share locks keep selected parents alive; a concurrent trigger always wins a conflict. */
      return tx<Array<{ after_id: string | null; scanned: number; inserted: number }>>`
        WITH source_page AS MATERIALIZED (
          SELECT id FROM embedding WHERE id > ${afterId} ORDER BY id LIMIT ${BATCH_SIZE}
        ), missing AS MATERIALIZED (
          SELECT p.id FROM source_page p
          WHERE NOT EXISTS (SELECT 1 FROM embedding_search s WHERE s.id = p.id)
        ), batch AS MATERIALIZED (
          SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled,
            e.embedding, e.embedding_384, e.embedding_768, e.embedding_1024, e.embedding_3072
          FROM missing m INNER JOIN embedding e ON e.id = m.id
          ORDER BY e.id FOR KEY SHARE OF e
        ), inserted AS (
          INSERT INTO embedding_search
            (id, knowledge_base_id, document_id, enabled, "binary", binary_384, binary_768, binary_1024, binary_3072)
          SELECT id, knowledge_base_id, document_id, enabled,
            binary_quantize(embedding)::bit(1536), binary_quantize(embedding_384)::bit(384),
            binary_quantize(embedding_768)::bit(768), binary_quantize(embedding_1024)::bit(1024),
            binary_quantize(embedding_3072)::bit(3072)
          FROM batch
          ON CONFLICT (id) DO NOTHING RETURNING id
        )
        SELECT max(id) AS after_id, count(*)::int AS scanned,
          (SELECT count(*)::int FROM inserted) AS inserted FROM source_page
      `
    })
    if (!page.after_id) break
    afterId = page.after_id
    count += page.inserted
    scanned += page.scanned
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Embedding candidate backfill progress', {
        scanned,
        inserted: count,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  /** New projections need usable cardinality estimates before the first app image reads them. */
  await sql.unsafe('ANALYZE embedding_search')
  return count
}

export const backfillEmbeddingSearchMigration: ScriptMigration = {
  name: '0015_backfill_embedding_search',
  async up(sql) {
    const rows = await backfillEmbeddingSearch(sql)
    logger.info('Embedding candidate projection initialized', { rows })
  },
}

/** db:push also installs database behavior that Drizzle's schema cannot express. */
if (import.meta.main) {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required to initialize embedding search')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await backfillEmbeddingSearchMigration.up(sql)
  } finally {
    await sql.end()
  }
}
