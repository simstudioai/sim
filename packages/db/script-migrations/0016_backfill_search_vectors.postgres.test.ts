import { backfillEmbeddingSearch } from '@sim/db/script-migrations/0015_backfill_embedding_search'
import { backfillSearchVectors } from '@sim/db/script-migrations/0016_backfill_search_vectors'
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
})
