import { readFileSync } from 'node:fs'
import { backfillEmbeddingSearch } from '@sim/db/script-migrations/0015_backfill_embedding_search'
import {
  backfillSearchKeywords,
  backfillSearchVectors,
  buildSearchIndexes,
} from '@sim/db/script-migrations/0016_backfill_search_vectors'
import { runScriptMigrations, scriptMigrations } from '@sim/db/script-migrations/index'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
const schemaName = `search_projection_${generateId().replaceAll('-', '')}`
const fields = ['vector', 'vector_384', 'vector_512', 'vector_768', 'vector_1024', 'vector_3072']

describe.runIf(Boolean(databaseUrl))('search projection upgrade in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!url.pathname.startsWith('/sim_acl_test') && url.pathname !== '/sim_auth_scim')
    ) {
      throw new Error('Projection tests require a disposable local integration database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    for (const table of ['knowledge_base', 'embedding', 'embedding_search']) {
      await admin.unsafe(
        `CREATE TABLE "${schemaName}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING GENERATED)`
      )
    }
    sql = postgres(url.toString(), {
      max: 1,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => undefined,
    })
    await sql.unsafe(
      'ALTER TABLE embedding_search ADD FOREIGN KEY (id) REFERENCES embedding(id) ON DELETE CASCADE'
    )
    await sql.unsafe(
      `ALTER TABLE embedding_search ${fields.map((field) => `DROP COLUMN ${field}`).join(', ')}`
    )
    await sql`INSERT INTO knowledge_base (id, user_id, name, workspace_id, embedding_model) VALUES
      ('prefix', 'reader', 'Prefix fixture', 'workspace', 'text-embedding-3-small'),
      ('full', 'reader', 'Full fixture', 'workspace', 'gemini-embedding-001')`
    await backfillEmbeddingSearch(sql)
    await sql.unsafe(`INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, embedding)
      SELECT 'chunk-' || n, CASE WHEN n % 2 = 0 THEN 'prefix' ELSE 'full' END, 'document-' || n,
        0, 'hash-' || n, 'Synthetic fixture', 17, 4, 0, 17,
        array_fill(0.01::real, ARRAY[1536])::vector(1536)
      FROM generate_series(1, 501) n`)
  }, 60_000)

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await admin.end()
    }
  })

  it('replays the additive schema before backfilling and building new indexes', async () => {
    const statements = readFileSync(
      new URL('../migrations/0346_half_precision_search_candidates.sql', import.meta.url),
      'utf8'
    )
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim().replaceAll('"public".', `"${schemaName}".`))
      .filter(Boolean)
    for (let replay = 0; replay < 2; replay++) {
      await sql.begin(async (tx) => {
        for (const statement of statements) await tx.unsafe(statement)
      })
    }
    expect(
      await sql`SELECT 1 FROM pg_index JOIN pg_class ON pg_class.oid = pg_index.indexrelid
      WHERE indrelid = 'embedding_search'::regclass AND relname LIKE '%cosine_hnsw_idx'`
    ).toHaveLength(0)
    expect((await sql`SELECT count(*)::int AS count FROM embedding_search`)[0].count).toBe(501)
  }, 60_000)

  it('serializes behind existing writers before upgrading the projection in batches', async () => {
    const writer = postgres(databaseUrl!, {
      max: 1,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => undefined,
    })
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    await writer`BEGIN`
    await writer`LOCK TABLE embedding IN ROW EXCLUSIVE MODE`
    const upgrade = Promise.allSettled([backfillSearchVectors(sql)])
    try {
      await vi.waitFor(async () => {
        const [{ waiting }] = await admin`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = ${pid}
            AND relation = ${`${schemaName}.embedding`}::regclass AND NOT granted
        ) AS waiting`
        expect(waiting).toBe(true)
      })
      await writer`UPDATE embedding SET enabled = false WHERE id = 'chunk-1'`
      await writer`COMMIT`
      const [result] = await upgrade
      if (result.status === 'rejected') throw result.reason
      expect(result.value).toBe(501)
    } finally {
      await writer`ROLLBACK`
      await upgrade
      await writer.end()
    }
    expect((await sql`SELECT enabled FROM embedding_search WHERE id = 'chunk-1'`)[0].enabled).toBe(
      false
    )
    const rows = await sql.unsafe(`SELECT knowledge_base_id,
      vector_dims(coalesce(${fields.join(', ')})) AS dimensions,
      num_nonnulls(${fields.join(', ')}) AS populated,
      "binary" IS NOT NULL AS legacy FROM embedding_search`)
    expect(rows).toHaveLength(501)
    for (const row of rows) {
      expect(row.dimensions).toBe(row.knowledge_base_id === 'prefix' ? 512 : 1536)
      expect(row.populated).toBe(1)
      expect(row.legacy).toBe(true)
    }
    expect(await backfillSearchVectors(sql)).toBe(0)
  }, 60_000)

  it('backfills identical keyword vectors and keeps content edits, scope changes, and deletes current', async () => {
    expect(await backfillSearchKeywords(sql)).toBe(501)
    expect(await backfillSearchKeywords(sql)).toBe(0)
    const [initial] = await sql`SELECT count(*)::int AS count FROM embedding e
      JOIN embedding_keyword_search s ON s.id = e.id
      WHERE e.content_tsv IS DISTINCT FROM s.content_tsv
        OR e.enabled IS DISTINCT FROM s.enabled
        OR e.knowledge_base_id IS DISTINCT FROM s.knowledge_base_id
        OR e.document_id IS DISTINCT FROM s.document_id`
    expect(initial.count).toBe(0)
    await sql`UPDATE embedding SET content = 'Revised deployment instructions',
      knowledge_base_id = 'full', document_id = 'revised-document', enabled = false
      WHERE id = 'chunk-2'`
    expect(
      await sql`SELECT knowledge_base_id, document_id, enabled,
      content_tsv = to_tsvector('english', 'Revised deployment instructions') AS current
      FROM embedding_keyword_search WHERE id = 'chunk-2'`
    ).toEqual([
      { knowledge_base_id: 'full', document_id: 'revised-document', enabled: false, current: true },
    ])
    await sql`DELETE FROM embedding WHERE id = 'chunk-2'`
    expect(await sql`SELECT id FROM embedding_keyword_search WHERE id = 'chunk-2'`).toHaveLength(0)
    expect(await backfillSearchKeywords(sql)).toBe(0)
  })

  it('repairs an interrupted index build and preserves valid indexes on replay', async () => {
    await expect(
      sql.unsafe(
        'CREATE UNIQUE INDEX CONCURRENTLY embedding_search_cosine_hnsw_idx ON embedding_search (knowledge_base_id)'
      )
    ).rejects.toMatchObject({ code: '23505' })
    expect(
      (
        await sql`SELECT indisvalid FROM pg_index WHERE indexrelid = 'embedding_search_cosine_hnsw_idx'::regclass`
      )[0].indisvalid
    ).toBe(false)
    await buildSearchIndexes(sql)
    const indexes = await sql`SELECT indexrelid, indisvalid FROM pg_index
      INNER JOIN pg_class ON pg_class.oid = pg_index.indexrelid
      WHERE indrelid IN ('embedding_search'::regclass, 'embedding_keyword_search'::regclass)
        AND (relname LIKE '%cosine_hnsw_idx' OR relname IN
          ('embedding_search_document_lookup_idx', 'embedding_keyword_search_kb_idx', 'embedding_keyword_search_document_idx', 'embedding_keyword_search_content_idx'))
      ORDER BY indexrelid`
    expect(indexes).toHaveLength(10)
    expect(indexes.every((index) => index.indisvalid)).toBe(true)
    await buildSearchIndexes(sql)
    const replay = await sql`SELECT indexrelid, indisvalid FROM pg_index
      INNER JOIN pg_class ON pg_class.oid = pg_index.indexrelid
      WHERE indrelid IN ('embedding_search'::regclass, 'embedding_keyword_search'::regclass)
        AND (relname LIKE '%cosine_hnsw_idx' OR relname IN
          ('embedding_search_document_lookup_idx', 'embedding_keyword_search_kb_idx', 'embedding_keyword_search_document_idx', 'embedding_keyword_search_content_idx'))
      ORDER BY indexrelid`
    expect(replay).toEqual(indexes)
  }, 60_000)

  it('allows other writers while the document lookup index waits for an existing writer', async () => {
    await sql.unsafe('DROP INDEX embedding_search_document_lookup_idx')
    const writer = postgres(databaseUrl!, {
      max: 1,
      connection: { search_path: `${schemaName},public` },
    })
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    await writer`BEGIN`
    await writer`LOCK TABLE embedding_search IN ROW EXCLUSIVE MODE`
    const build = Promise.allSettled([buildSearchIndexes(sql)])
    try {
      await vi.waitFor(async () => {
        const [{ waiting }] = await admin`SELECT wait_event_type = 'Lock' AS waiting
          FROM pg_stat_activity WHERE pid = ${pid}`
        expect(waiting).toBe(true)
      })
      await admin.begin(async (tx) => {
        await tx.unsafe("SET LOCAL lock_timeout = '1s'")
        await tx.unsafe(`LOCK TABLE "${schemaName}".embedding_search IN ROW EXCLUSIVE MODE`)
      })
    } finally {
      await writer`ROLLBACK`
      await writer.end()
      await build
    }
    const [result] = await build
    if (result.status === 'rejected') throw result.reason
    expect(
      (
        await sql`SELECT indisvalid FROM pg_index
        WHERE indexrelid = 'embedding_search_document_lookup_idx'::regclass`
      )[0].indisvalid
    ).toBe(true)
  })

  it('keeps inserts, state changes, width changes, and deletes synchronous after the upgrade', async () => {
    await sql.unsafe(`INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, embedding_384)
      VALUES ('inserted', 'prefix', 'inserted-document', 0, 'inserted-hash', 'Synthetic fixture', 17, 4, 0, 17,
        array_fill(0.01::real, ARRAY[384])::vector(384))`)
    const [inserted] = await sql.unsafe(`SELECT vector_dims(vector_384) AS dimensions,
      num_nonnulls(${fields.join(', ')}) AS populated, binary_384 IS NOT NULL AS legacy
      FROM embedding_search WHERE id = 'inserted'`)
    expect(inserted).toEqual({ dimensions: 384, populated: 1, legacy: true })
    await sql`UPDATE embedding SET enabled = false WHERE id = 'chunk-1'`
    expect((await sql`SELECT enabled FROM embedding_search WHERE id = 'chunk-1'`)[0].enabled).toBe(
      false
    )
    await sql.unsafe(`UPDATE embedding SET embedding = NULL,
      embedding_3072 = array_fill(0.02::real, ARRAY[3072])::vector(3072) WHERE id = 'chunk-1'`)
    const [row] = await sql.unsafe(`SELECT vector_dims(vector_3072) AS dimensions,
      num_nonnulls(${fields.join(', ')}) AS populated, binary_3072 IS NOT NULL AS legacy
      FROM embedding_search WHERE id = 'chunk-1'`)
    expect(row).toEqual({ dimensions: 3072, populated: 1, legacy: true })
    expect(await backfillSearchVectors(sql)).toBe(0)
    await sql`DELETE FROM embedding WHERE id = 'chunk-1'`
    expect(await sql`SELECT id FROM embedding_search WHERE id = 'chunk-1'`).toHaveLength(0)
  })

  it.each([128, 512])(
    'stores a %i-token keyword vector without widening semantic candidates',
    async (tokens) => {
      const id = generateId()
      await sql.unsafe(
        `INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
        token_count, start_offset, end_offset, embedding)
      SELECT $1, 'full', $1, 0, $1, string_agg(md5(n::text), ' '), $2 * 33,
        $2, 0, $2 * 33, array_fill(0.01::real, ARRAY[1536])::vector(1536)
      FROM generate_series(1, $2::int) n`,
        [id, tokens]
      )
      const [row] = await sql`SELECT s.content_tsv = e.content_tsv AS identical,
      pg_column_toast_chunk_id(s.content_tsv) IS NULL AS inline,
      pg_column_size(s.content_tsv) AS bytes
      FROM embedding_keyword_search s JOIN embedding e ON e.id = s.id WHERE s.id = ${id}`
      expect(row.identical).toBe(true)
      expect(row.bytes).toBeGreaterThan(2048)
      expect(row.inline).toBe(tokens === 128)
      expect(
        (await sql`SELECT count(*)::int AS count FROM embedding_search WHERE id = ${id}`)[0].count
      ).toBe(1)
    }
  )

  it.each([1536, 3072])(
    'keeps lookup identities inline beside %i-dimensional vectors',
    async (width) => {
      const knowledgeBaseId = generateId()
      const documentId = generateId()
      const chunkId = generateId()
      await sql`INSERT INTO knowledge_base (id, user_id, name, workspace_id, embedding_model)
      VALUES (${knowledgeBaseId}, 'reader', ${`Wide fixture ${width}`}, 'workspace', 'gemini-embedding-001')`
      const vectorColumn = width === 1536 ? 'embedding' : 'embedding_3072'
      await sql.unsafe(
        `INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, ${vectorColumn})
      VALUES ($1, $2, $3, 0, 'wide-hash', 'Synthetic fixture', 17, 4, 0, 17,
        array_fill(0.01::real, ARRAY[${width}])::vector(${width}))`,
        [chunkId, knowledgeBaseId, documentId]
      )
      const [row] = await sql`SELECT pg_column_toast_chunk_id(id) AS chunk,
      pg_column_toast_chunk_id(knowledge_base_id) AS knowledge_base,
      pg_column_toast_chunk_id(document_id) AS document
      FROM embedding_search WHERE id = ${chunkId}`
      expect(row).toEqual({ chunk: null, knowledge_base: null, document: null })
    }
  )

  it.each([
    { name: 'binary', table: 'embedding_search', backfill: backfillEmbeddingSearch },
    { name: 'vector', table: 'embedding_search', backfill: backfillSearchVectors },
    { name: 'keyword', table: 'embedding_keyword_search', backfill: backfillSearchKeywords },
  ])(
    'resumes $name after cancellation and traverses fully populated source pages',
    async ({ name, table, backfill }) => {
      await backfillSearchVectors(sql)
      await sql.unsafe(`INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
        token_count, start_offset, end_offset, embedding)
      SELECT 'recovery-' || lpad(n::text, 4, '0'), 'prefix', 'recovery-document', n,
        'recovery-hash-' || n, 'Synthetic recovery fixture', 26, 4, 0, 26,
        array_fill(0.01::real, ARRAY[1536])::vector(1536)
      FROM generate_series(1, 1001) n`)
      if (name === 'vector') {
        await sql.unsafe(`UPDATE embedding_search SET ${fields.map((field) => `${field} = NULL`).join(', ')}
        WHERE id LIKE 'recovery-%'`)
      } else {
        await sql.unsafe(`DELETE FROM ${table} WHERE id LIKE 'recovery-%'`)
      }
      await sql.unsafe(`CREATE FUNCTION cancel_projection_batch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = 'recovery-0750' THEN
          RAISE EXCEPTION 'Synthetic statement cancellation' USING ERRCODE = '57014';
        END IF;
        RETURN NEW;
      END;
      $$`)
      await sql.unsafe(`CREATE TRIGGER cancel_projection_batch BEFORE INSERT OR UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION cancel_projection_batch()`)
      try {
        await expect(backfill(sql)).rejects.toMatchObject({ code: '57014' })
      } finally {
        await sql.unsafe(`DROP TRIGGER cancel_projection_batch ON ${table}`)
        await sql.unsafe('DROP FUNCTION cancel_projection_batch()')
      }
      const populated = name === 'vector' ? `AND coalesce(${fields.join(', ')}) IS NOT NULL` : ''
      const [{ committed }] = await sql.unsafe<Array<{ committed: number }>>(`
      SELECT count(*)::int AS committed FROM ${table} WHERE id LIKE 'recovery-%' ${populated}`)
      expect(committed).toBeGreaterThan(0)
      expect(committed).toBeLessThan(750)
      expect(await backfill(sql)).toBe(1001 - committed)
      expect(await backfill(sql)).toBe(0)
      if (name === 'vector') {
        await sql.unsafe(`UPDATE embedding_search SET ${fields.map((field) => `${field} = NULL`).join(', ')}
        WHERE id = 'recovery-1001'`)
      } else {
        await sql.unsafe(`DELETE FROM ${table} WHERE id = 'recovery-1001'`)
      }
      expect(await backfill(sql)).toBe(1)
      await sql`DELETE FROM embedding WHERE id LIKE 'recovery-%'`
    },
    60_000
  )

  it('runs 0016 directly after a partially committed, unjournaled 0015', async () => {
    await sql`CREATE TABLE script_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    for (const migration of scriptMigrations) {
      if (migration.name < '0015') {
        await sql`INSERT INTO script_migrations (name) VALUES (${migration.name})`
      }
    }
    await backfillEmbeddingSearch(sql)
    await sql.unsafe(`INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
        token_count, start_offset, end_offset, embedding)
      SELECT 'upgrade-' || lpad(n::text, 4, '0'), 'prefix', 'upgrade-document', n,
        'upgrade-hash-' || n, 'Synthetic upgrade fixture', 25, 4, 0, 25,
        array_fill(0.01::real, ARRAY[1536])::vector(1536)
      FROM generate_series(1, 1001) n`)
    await sql`DELETE FROM embedding_search WHERE id > 'upgrade-0501' AND id LIKE 'upgrade-%'`
    await sql`DELETE FROM embedding_keyword_search WHERE id LIKE 'upgrade-%'`
    await sql.unsafe(`CREATE FUNCTION cancel_projection_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = 'upgrade-0750' THEN
          RAISE EXCEPTION 'Synthetic upgrade cancellation' USING ERRCODE = '57014';
        END IF;
        RETURN NEW;
      END;
      $$`)
    await sql.unsafe(`CREATE TRIGGER cancel_projection_upgrade BEFORE INSERT OR UPDATE ON embedding_search
      FOR EACH ROW EXECUTE FUNCTION cancel_projection_upgrade()`)
    try {
      await expect(runScriptMigrations(sql)).rejects.toMatchObject({ code: '57014' })
      expect(await sql`SELECT name FROM script_migrations WHERE name >= '0015'`).toHaveLength(0)
    } finally {
      await sql.unsafe('DROP TRIGGER cancel_projection_upgrade ON embedding_search')
      await sql.unsafe('DROP FUNCTION cancel_projection_upgrade()')
    }
    await runScriptMigrations(sql)
    expect(
      await sql`SELECT name FROM script_migrations WHERE name >= '0015' ORDER BY name`
    ).toEqual([
      { name: '0015_backfill_embedding_search' },
      { name: '0016_backfill_search_vectors' },
      { name: '0017_index_search_documents' },
    ])
    const [{ complete }] = await sql`SELECT count(*)::int AS complete FROM embedding e
      JOIN embedding_search s ON s.id = e.id JOIN embedding_keyword_search k ON k.id = e.id
      WHERE e.id LIKE 'upgrade-%' AND s."binary" = binary_quantize(e.embedding)::bit(1536)
        AND s.vector_512 = subvector(e.embedding, 1, 512)::halfvec(512)
        AND k.content_tsv = e.content_tsv`
    expect(complete).toBe(1001)
    await runScriptMigrations(sql)
    await sql`DELETE FROM embedding WHERE id LIKE 'upgrade-%'`
  }, 60_000)
})
