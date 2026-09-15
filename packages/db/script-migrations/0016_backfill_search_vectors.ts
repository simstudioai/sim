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
    /** Acquire source and projection locks in the same order as embedding writers. */
    await tx.unsafe('LOCK TABLE embedding IN SHARE ROW EXCLUSIVE MODE')
    /** Wide inline vectors must not push lookup identities into overflow storage. */
    await tx.unsafe(
      `ALTER TABLE embedding_search ${['id', 'knowledge_base_id', 'document_id', ...columns].map((column) => `ALTER COLUMN ${column} SET STORAGE PLAIN`).join(', ')}`
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
  let scanned = 0
  const startedAt = Date.now()
  for (;;) {
    const [page] = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      return tx.unsafe<Array<{ after_id: string | null; scanned: number; inserted: number }>>(
        `
        WITH source_page AS MATERIALIZED (
          SELECT id FROM embedding WHERE id > $1 ORDER BY id LIMIT ${BATCH_SIZE}
        ), missing AS MATERIALIZED (
          SELECT p.id FROM source_page p WHERE NOT EXISTS (
            SELECT 1 FROM embedding_search s WHERE s.id = p.id AND NOT (${missing})
          )
        ), batch AS MATERIALIZED (
          SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled,
            e.embedding, e.embedding_384, e.embedding_768, e.embedding_1024, e.embedding_3072,
            k.embedding_model IN ('text-embedding-3-small', 'text-embedding-3-large')
              AND e.embedding_384 IS NULL AS shortened
          FROM missing m INNER JOIN embedding e ON e.id = m.id
          INNER JOIN knowledge_base k ON k.id = e.knowledge_base_id
          ORDER BY e.id FOR KEY SHARE OF e
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
          WHERE ${missing} RETURNING id
        ) SELECT max(id) AS after_id, count(*)::int AS scanned,
          (SELECT count(*)::int FROM inserted) AS inserted FROM source_page`,
        [afterId]
      )
    })
    if (!page.after_id) break
    afterId = page.after_id
    count += page.inserted
    scanned += page.scanned
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Vector search backfill progress', {
        scanned,
        inserted: count,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  await sql.unsafe('VACUUM (ANALYZE) embedding_search')
  return count
}

/** Keeps keyword scoring independent of the full-vector and chunk-content storage working sets. */
export async function backfillSearchKeywords(sql: Sql): Promise<number> {
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'")
    await tx.unsafe('LOCK TABLE embedding IN SHARE ROW EXCLUSIVE MODE')
    await tx.unsafe(`ALTER TABLE embedding_keyword_search
      ALTER COLUMN id SET STORAGE PLAIN,
      ALTER COLUMN knowledge_base_id SET STORAGE PLAIN,
      ALTER COLUMN document_id SET STORAGE PLAIN,
      ALTER COLUMN content_tsv SET STORAGE MAIN`)
    await tx.unsafe(`CREATE OR REPLACE FUNCTION sync_embedding_keyword_search()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO embedding_keyword_search (id, knowledge_base_id, document_id, enabled, content_tsv)
        VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled, NEW.content_tsv)
        ON CONFLICT (id) DO UPDATE SET
          knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
          enabled = EXCLUDED.enabled, content_tsv = EXCLUDED.content_tsv;
        RETURN NEW;
      END;
      $$`)
    await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_keyword_search_sync
      AFTER INSERT OR UPDATE OF knowledge_base_id, document_id, enabled, content ON embedding
      FOR EACH ROW EXECUTE FUNCTION sync_embedding_keyword_search()`)
  })
  let afterId = ''
  let count = 0
  let scanned = 0
  const startedAt = Date.now()
  for (;;) {
    const [page] = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'")
      await tx.unsafe("SET LOCAL statement_timeout = '60s'")
      return tx.unsafe<Array<{ after_id: string | null; scanned: number; inserted: number }>>(
        `
        WITH source_page AS MATERIALIZED (
          SELECT id FROM embedding WHERE id > $1 ORDER BY id LIMIT ${BATCH_SIZE}
        ), missing AS MATERIALIZED (
          SELECT p.id FROM source_page p WHERE NOT EXISTS (
            SELECT 1 FROM embedding_keyword_search s WHERE s.id = p.id
          )
        ), batch AS MATERIALIZED (
          SELECT e.id, e.knowledge_base_id, e.document_id, e.enabled, e.content_tsv
          FROM missing m INNER JOIN embedding e ON e.id = m.id
          ORDER BY e.id FOR KEY SHARE OF e
        ), inserted AS (
          INSERT INTO embedding_keyword_search (id, knowledge_base_id, document_id, enabled, content_tsv)
          SELECT id, knowledge_base_id, document_id, enabled, content_tsv FROM batch
          ON CONFLICT (id) DO NOTHING RETURNING id
        ) SELECT max(id) AS after_id, count(*)::int AS scanned,
          (SELECT count(*)::int FROM inserted) AS inserted FROM source_page`,
        [afterId]
      )
    })
    if (!page.after_id) break
    afterId = page.after_id
    count += page.inserted
    scanned += page.scanned
    if (scanned % (BATCH_SIZE * 100) === 0) {
      logger.info('Keyword search backfill progress', {
        scanned,
        inserted: count,
        elapsedMs: Date.now() - startedAt,
      })
    }
  }
  await sql.unsafe('VACUUM (ANALYZE) embedding_keyword_search')
  return count
}

/** Builds new indexes after bulk loading; interrupted builds are repaired without rebuilding valid ones. */
export async function buildSearchIndexes(sql: Sql): Promise<void> {
  const indexes = [
    ...WIDTHS.map((width) => ({
      name: `embedding_search${width === 1536 ? '' : `_${width}`}_cosine_hnsw_idx`,
      table: 'embedding_search',
      definition: `ON embedding_search USING hnsw (${field('vector', width)} halfvec_cosine_ops) WITH (m=16, ef_construction=64)`,
    })),
    {
      name: 'embedding_keyword_search_kb_idx',
      table: 'embedding_keyword_search',
      definition: 'ON embedding_keyword_search (knowledge_base_id)',
    },
    {
      name: 'embedding_keyword_search_document_idx',
      table: 'embedding_keyword_search',
      definition: 'ON embedding_keyword_search (document_id)',
    },
    {
      name: 'embedding_keyword_search_content_idx',
      table: 'embedding_keyword_search',
      definition: 'ON embedding_keyword_search USING gin (content_tsv)',
    },
  ]
  const [{ timeout }] = await sql`SELECT current_setting('lock_timeout') AS timeout`
  await sql.unsafe('SET lock_timeout = 0')
  try {
    for (const { name, table, definition } of indexes) {
      const [existing] =
        await sql`SELECT i.indisvalid, format('%I.%I', n.nspname, c.relname) AS qualified_name
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE i.indrelid = to_regclass(${table}) AND c.relname = ${name}`
      if (existing?.indisvalid) continue
      if (existing) await sql.unsafe(`DROP INDEX CONCURRENTLY ${existing.qualified_name}`)
      const startedAt = Date.now()
      logger.info('Building search index', { index: name })
      await sql.unsafe(`CREATE INDEX CONCURRENTLY ${name} ${definition}`)
      logger.info('Search index built', { index: name, elapsedMs: Date.now() - startedAt })
    }
  } finally {
    await sql`SELECT set_config('lock_timeout', ${timeout}, false)`
  }
}

export const backfillSearchVectorsMigration: ScriptMigration = {
  name: '0016_backfill_search_vectors',
  async up(sql) {
    const rows = await backfillSearchVectors(sql)
    const keywordRows = await backfillSearchKeywords(sql)
    await buildSearchIndexes(sql)
    logger.info('Search projections initialized', { rows, keywordRows })
  },
}

if (import.meta.main) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required to initialize search vectors')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    await backfillSearchVectorsMigration.up(sql)
  } finally {
    await sql.end()
  }
}
