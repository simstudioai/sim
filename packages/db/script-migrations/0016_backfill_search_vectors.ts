import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'

const logger = createLogger('SearchVectorProjection')
const BATCH_SIZE = 500
const WIDTHS = [1536, 384, 512, 768, 1024, 3072] as const
const SOURCE_WIDTHS = [1536, 384, 768, 1024, 3072] as const
const field = (name: string, width: number) => (width === 1536 ? name : `${name}_${width}`)
const columns = WIDTHS.map((width) => field('vector', width))
const missing = columns.map((column) => `s.${column} IS NULL`).join(' AND ')

/** Shortening is valid only for the two OpenAI models trained for prefix retrieval. */
function projections(prefix: string, shortened: string): string {
  return WIDTHS.map((width) =>
    width === 512
      ? `CASE WHEN ${shortened} THEN subvector(coalesce(${SOURCE_WIDTHS.map((size) => `${prefix}.${field('embedding', size)}`).join(', ')}), 1, 512)::halfvec(512) END`
      : `CASE WHEN NOT (${shortened}) THEN ${prefix}.${field('embedding', width)}::halfvec(${width}) END`
  ).join(', ')
}

/** Replaces the projection atomically, then fills only missing rows in independently committed pages. */
export async function backfillSearchVectors(sql: Sql): Promise<number> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe(
      `ALTER TABLE embedding_search ${columns.map((column) => `ALTER COLUMN ${column} SET STORAGE PLAIN`).join(', ')}`
    )
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_search()
      RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE shortened boolean;
      BEGIN
        SELECT embedding_model IN ('text-embedding-3-small', 'text-embedding-3-large')
          AND NEW.embedding_384 IS NULL INTO STRICT shortened
        FROM knowledge_base WHERE id = NEW.knowledge_base_id;
        INSERT INTO embedding_search
          (id, knowledge_base_id, document_id, enabled,
            "binary", binary_384, binary_768, binary_1024, binary_3072, ${columns.join(', ')})
        VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled,
          binary_quantize(NEW.embedding)::bit(1536), binary_quantize(NEW.embedding_384)::bit(384),
          binary_quantize(NEW.embedding_768)::bit(768), binary_quantize(NEW.embedding_1024)::bit(1024),
          binary_quantize(NEW.embedding_3072)::bit(3072), ${projections('NEW', 'shortened')})
        ON CONFLICT (id) DO UPDATE SET
          knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
          enabled = EXCLUDED.enabled, "binary" = EXCLUDED."binary", binary_384 = EXCLUDED.binary_384,
          binary_768 = EXCLUDED.binary_768, binary_1024 = EXCLUDED.binary_1024,
          binary_3072 = EXCLUDED.binary_3072,
          ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')};
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
  for (;;) {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      return tx.unsafe<Array<{ id: string }>>(
        `
        WITH batch AS MATERIALIZED (
          SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled,
            e.embedding, e.embedding_384, e.embedding_768, e.embedding_1024, e.embedding_3072,
            k.embedding_model IN ('text-embedding-3-small', 'text-embedding-3-large')
              AND e.embedding_384 IS NULL AS shortened
          FROM embedding e INNER JOIN knowledge_base k ON k.id = e.knowledge_base_id
          WHERE e.id > $1 AND NOT EXISTS (
            SELECT 1 FROM embedding_search s WHERE s.id = e.id AND NOT (${missing})
          )
          ORDER BY e.id LIMIT ${BATCH_SIZE} FOR KEY SHARE OF e
        ), inserted AS (
          INSERT INTO embedding_search AS s
            (id, knowledge_base_id, document_id, enabled,
              "binary", binary_384, binary_768, binary_1024, binary_3072, ${columns.join(', ')})
          SELECT id, knowledge_base_id, document_id, enabled,
            binary_quantize(embedding)::bit(1536), binary_quantize(embedding_384)::bit(384),
            binary_quantize(embedding_768)::bit(768), binary_quantize(embedding_1024)::bit(1024),
            binary_quantize(embedding_3072)::bit(3072), ${projections('batch', 'shortened')}
          FROM batch ON CONFLICT (id) DO UPDATE SET
            ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}
          WHERE ${missing}
        ) SELECT id FROM batch ORDER BY id`,
        [afterId]
      )
    })
    if (!rows.length) break
    afterId = rows[rows.length - 1].id
    count += rows.length
  }
  await sql.unsafe('VACUUM (ANALYZE) embedding_search')
  return count
}

export const backfillSearchVectorsMigration: ScriptMigration = {
  name: '0016_backfill_search_vectors',
  async up(sql) {
    const rows = await backfillSearchVectors(sql)
    logger.info('Search vector projection initialized', { rows })
  },
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to initialize search vectors')
  const sql = postgres(url, { max: 1, onnotice: () => undefined })
  try {
    await backfillSearchVectorsMigration.up(sql)
  } finally {
    await sql.end()
  }
}
