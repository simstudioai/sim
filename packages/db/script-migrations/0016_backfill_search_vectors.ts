import {
  SEARCH_VECTOR_COLUMNS,
  SYNCHRONOUS_PROJECTION_WHEN,
  searchBinaryProjections,
  searchVectorProjections,
  searchVectorShortened,
} from '@sim/db/knowledge-projection'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import postgres, { type Sql, type TransactionSql } from 'postgres'

const logger = createLogger('SearchVectorProjection')
const BATCH_SIZE = 500
const columns = SEARCH_VECTOR_COLUMNS
const missing = columns.map((column) => `s.${column} IS NULL`).join(' AND ')

/**
 * The vector projection's trigger, skipped by a writer that declared the asynchronous projection
 * mode; see `0024_knowledge_projection_async`.
 */
export async function installSearchVectorTrigger(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_search_sync
    AFTER INSERT OR UPDATE OF knowledge_base_id, document_id, enabled,
      embedding, embedding_384, embedding_768, embedding_1024, embedding_3072 ON embedding
    FOR EACH ROW WHEN (${SYNCHRONOUS_PROJECTION_WHEN}) EXECUTE FUNCTION sync_embedding_search()`)
}

/** The keyword projection's trigger, skipped the same way as {@link installSearchVectorTrigger}. */
export async function installSearchKeywordTrigger(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE TRIGGER embedding_keyword_search_sync
    AFTER INSERT OR UPDATE OF knowledge_base_id, document_id, enabled, content ON embedding
    FOR EACH ROW WHEN (${SYNCHRONOUS_PROJECTION_WHEN}) EXECUTE FUNCTION sync_embedding_keyword_search()`)
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
        SELECT ${searchVectorShortened('embedding_model', 'NEW')} INTO STRICT shortened
        FROM knowledge_base WHERE id = NEW.knowledge_base_id;
        INSERT INTO embedding_search
          (id, knowledge_base_id, document_id, enabled,
            "binary", binary_384, binary_768, binary_1024, binary_3072, ${columns.join(', ')})
        VALUES (NEW.id, NEW.knowledge_base_id, NEW.document_id, NEW.enabled,
          ${searchBinaryProjections('NEW')}, ${searchVectorProjections('NEW', 'shortened')})
        ON CONFLICT (id) DO UPDATE SET
          knowledge_base_id = EXCLUDED.knowledge_base_id, document_id = EXCLUDED.document_id,
          enabled = EXCLUDED.enabled, "binary" = EXCLUDED."binary", binary_384 = EXCLUDED.binary_384,
          binary_768 = EXCLUDED.binary_768, binary_1024 = EXCLUDED.binary_1024,
          binary_3072 = EXCLUDED.binary_3072,
          ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')};
        RETURN NEW;
      END;
      $$`)
    await installSearchVectorTrigger(tx)
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
            ${searchVectorShortened('k.embedding_model', 'e')} AS shortened
          FROM missing m INNER JOIN embedding e ON e.id = m.id
          INNER JOIN knowledge_base k ON k.id = e.knowledge_base_id
          ORDER BY e.id FOR KEY SHARE OF e
        ), inserted AS (
          INSERT INTO embedding_search AS s
            (id, knowledge_base_id, document_id, enabled,
              "binary", binary_384, binary_768, binary_1024, binary_3072, ${columns.join(', ')})
          SELECT id, knowledge_base_id, document_id, enabled,
            ${searchBinaryProjections('batch')}, ${searchVectorProjections('batch', 'shortened')}
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
    await installSearchKeywordTrigger(tx)
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
    {
      name: 'embedding_search_document_lookup_idx',
      table: 'embedding_search',
      definition: 'ON embedding_search (document_id, knowledge_base_id, id) WHERE enabled',
    },
    ...columns.map((column) => ({
      name: `embedding_search${column.replace(/^vector/, '')}_cosine_hnsw_idx`,
      table: 'embedding_search',
      definition: `ON embedding_search USING hnsw (${column} halfvec_cosine_ops) WITH (m=16, ef_construction=64)`,
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
  supersedes: ['0015_backfill_embedding_search'],
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
