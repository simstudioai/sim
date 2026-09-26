import { readFile } from 'node:fs/promises'
import { backfillEmbeddingSearch } from '@sim/db/script-migrations/0015_backfill_embedding_search'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const SUPPORTED_WIDTHS = [384, 768, 1024, 1536, 3072] as const
type EmbeddingWidth = (typeof SUPPORTED_WIDTHS)[number]

/** Replays the historical vector DDL so db-push cannot hide migration-only constraints. */
describe('embedding width migration in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let correctiveMigration: string
  const schema = `embedding_width_${generateId().replaceAll('-', '')}`

  async function applyMigration(contents: string) {
    for (const statement of contents.split('--> statement-breakpoint')) {
      if (statement.trim()) await sql.unsafe(statement)
    }
  }

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schema}"`)
    sql = postgres(databaseUrl, {
      max: 1,
      connection: { search_path: `${schema},public` },
      onnotice: () => undefined,
    })
    const originalMigration = await readFile(
      new URL('./migrations/0039_tranquil_speed.sql', import.meta.url),
      'utf8'
    )
    const embeddingTable = originalMigration.match(
      /CREATE TABLE IF NOT EXISTS "embedding" \([\s\S]*?\n\);/
    )?.[0]
    if (!embeddingTable) throw new Error('Original embedding table DDL was not found')
    await sql.unsafe(embeddingTable)
    await applyMigration(
      await readFile(
        new URL('./migrations/0321_multi_width_embeddings.sql', import.meta.url),
        'utf8'
      )
    )
    correctiveMigration = await readFile(
      new URL('./migrations/0335_embedding_width_nullable.sql', import.meta.url),
      'utf8'
    )
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  beforeEach(async () => {
    await sql`TRUNCATE embedding CASCADE`
    await sql`ALTER TABLE embedding ALTER COLUMN embedding SET NOT NULL`
  })

  function vector(width: EmbeddingWidth) {
    return JSON.stringify(Array.from({ length: width }, (_, index) => (index === 0 ? 1 : 0)))
  }

  async function insertEmbedding(width: EmbeddingWidth, id: string) {
    const column = width === 1536 ? 'embedding' : `embedding_${width}`
    await sql`INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
       token_count, start_offset, end_offset, ${sql(column)})
      VALUES (${id}, 'kb', 'document', 0, 'fixture', 'Fixture', 7, 1, 0, 7, ${vector(width)}::vector)`
  }

  it('repairs fresh canonical 768/3072 writes and preserves existing 1536 vectors', async () => {
    await insertEmbedding(1536, 'legacy')
    for (const width of [768, 3072] as const) {
      await expect(insertEmbedding(width, `width-${width}`)).rejects.toMatchObject({
        code: '23502',
        column_name: 'embedding',
      })
    }
    await applyMigration(correctiveMigration)
    for (const width of [768, 3072] as const) {
      await insertEmbedding(width, `width-${width}`)
    }
    expect(await sql`SELECT embedding::text AS value FROM embedding WHERE id = 'legacy'`).toEqual([
      { value: vector(1536) },
    ])
  })

  it('accepts exactly one vector at every supported width after replay', async () => {
    await applyMigration(correctiveMigration)
    await applyMigration(correctiveMigration)
    for (const width of SUPPORTED_WIDTHS) await insertEmbedding(width, `width-${width}`)
    expect(await sql`SELECT count(*)::int AS count FROM embedding`).toEqual([{ count: 5 }])
    expect(
      await sql`SELECT convalidated FROM pg_constraint
        WHERE conrelid = 'embedding'::regclass AND conname = 'embedding_width_check'`
    ).toEqual([{ convalidated: true }])
  })

  it('continues rejecting rows without a vector or with multiple vector widths', async () => {
    await applyMigration(correctiveMigration)
    await expect(sql`INSERT INTO embedding
      (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
       token_count, start_offset, end_offset)
      VALUES ('empty', 'kb', 'document', 0, 'fixture', 'Fixture', 7, 1, 0, 7)`).rejects.toMatchObject(
      { code: '23514', constraint_name: 'embedding_width_check' }
    )
    await insertEmbedding(1536, 'legacy')
    await expect(
      sql`UPDATE embedding SET embedding_768 = ${vector(768)}::vector WHERE id = 'legacy'`
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'embedding_width_check' })
  })

  it('rebuilds compact candidate indexes on replay and uses them at every stored width', async () => {
    await applyMigration(correctiveMigration)
    const migration = await readFile(
      new URL('./migrations/0342_clean_weapon_omega.sql', import.meta.url),
      'utf8'
    )
    for (const width of SUPPORTED_WIDTHS) {
      await insertEmbedding(width, `width-${width}`)
      const name =
        width === 1536 ? 'embedding_binary_hnsw_idx' : `embedding_${width}_binary_hnsw_idx`
      /** Seed interrupted builds in the isolated schema, never an index in the shared public schema. */
      await sql.unsafe(`CREATE INDEX "${name}" ON embedding (id)`)
    }
    await applyMigration(migration)
    await applyMigration(migration)
    await sql`SET enable_seqscan = off`
    try {
      for (const width of SUPPORTED_WIDTHS) {
        const column = width === 1536 ? 'embedding' : `embedding_${width}`
        const name =
          width === 1536 ? 'embedding_binary_hnsw_idx' : `embedding_${width}_binary_hnsw_idx`
        const plan = await sql.unsafe(
          `EXPLAIN (FORMAT JSON) SELECT id FROM embedding
          ORDER BY binary_quantize("${column}")::bit(${width}) <~> binary_quantize($1::vector)::bit(${width}) LIMIT 1`,
          [vector(width)]
        )
        expect(JSON.stringify(plan)).toContain(name)
      }
      const indexes = await sql`SELECT count(*)::int AS count FROM pg_index
        WHERE indrelid = 'embedding'::regclass AND indisvalid`
      expect(indexes[0].count).toBeGreaterThanOrEqual(10)
    } finally {
      await sql`RESET enable_seqscan`
    }
  })

  describe('stored candidate projection', () => {
    beforeAll(async () => {
      await sql`ALTER TABLE embedding ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`
      const migration = await readFile(
        new URL('./migrations/0343_stored_embedding_candidates.sql', import.meta.url),
        'utf8'
      )
      const scoped = migration.replaceAll('"public"."embedding"', `"${schema}"."embedding"`)
      await applyMigration(scoped)
      await applyMigration(scoped)
    })

    beforeEach(async () => {
      await applyMigration(correctiveMigration)
      await backfillEmbeddingSearch(sql)
    })

    it('backfills multiple committed pages and replays without replacing newer values', async () => {
      await sql`DROP TRIGGER embedding_search_sync ON embedding`
      await sql`INSERT INTO embedding
        (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
         token_count, start_offset, end_offset, embedding)
        SELECT 'legacy-' || n, 'kb', 'document', n, 'fixture', 'Fixture', 7, 1, 0, 7,
          ${vector(1536)}::vector
        FROM generate_series(1, 1001) n`
      expect(await backfillEmbeddingSearch(sql)).toBe(1001)
      expect(await backfillEmbeddingSearch(sql)).toBe(0)
      expect(await sql`SELECT count(*)::int AS count FROM embedding_search`).toEqual([
        { count: 1001 },
      ])
      expect(
        await sql`SELECT count(*)::int AS count FROM embedding e JOIN embedding_search s USING(id)
        WHERE s.binary IS DISTINCT FROM binary_quantize(e.embedding)::bit(1536)`
      ).toEqual([{ count: 0 }])
    })

    it('derives the correct stored bits for legacy writers at every width', async () => {
      for (const width of SUPPORTED_WIDTHS) {
        await insertEmbedding(width, `stored-${width}`)
        const column = width === 1536 ? 'binary' : `binary_${width}`
        expect(
          await sql`SELECT ${sql(column)}::text AS bits FROM embedding_search WHERE id = ${`stored-${width}`}`
        ).toEqual([{ bits: `1${'0'.repeat(width - 1)}` }])
        const plan = await sql.begin(async (tx) => {
          await tx`SET LOCAL enable_seqscan = off`
          return tx.unsafe(
            `EXPLAIN (VERBOSE, FORMAT JSON) SELECT id FROM embedding_search
            ORDER BY "${column}" <~> binary_quantize($1::vector)::bit(${width}) LIMIT 1`,
            [vector(width)]
          )
        })
        const serialized = JSON.stringify(plan)
        expect(serialized).toContain(
          `embedding_search_${width === 1536 ? '' : `${width}_`}binary_hnsw_idx`
        )
        expect(serialized).not.toContain('binary_quantize(embedding.')
      }
    })

    it('updates scope, enablement, and width atomically and cascades deletion', async () => {
      await insertEmbedding(1536, 'changed')
      await sql`UPDATE embedding SET enabled = false, knowledge_base_id = 'other-kb', document_id = 'other-document',
        embedding = NULL, embedding_768 = ${vector(768)}::vector WHERE id = 'changed'`
      expect(
        await sql`SELECT knowledge_base_id, document_id, enabled, "binary", binary_768::text AS bits
        FROM embedding_search WHERE id = 'changed'`
      ).toEqual([
        {
          knowledge_base_id: 'other-kb',
          document_id: 'other-document',
          enabled: false,
          binary: null,
          bits: `1${'0'.repeat(767)}`,
        },
      ])
      await sql`DELETE FROM embedding WHERE id = 'changed'`
      expect(await sql`SELECT id FROM embedding_search`).toEqual([])
    })

    it('rolls back the projection together with a failed embedding write transaction', async () => {
      await insertEmbedding(1536, 'rollback')
      await expect(
        sql.begin(async (tx) => {
          await tx`UPDATE embedding SET enabled = false WHERE id = 'rollback'`
          throw new Error('Fixture rollback')
        })
      ).rejects.toThrow('Fixture rollback')
      expect(await sql`SELECT enabled FROM embedding_search WHERE id = 'rollback'`).toEqual([
        { enabled: true },
      ])
    })

    it('keeps concurrent updates and deletes authoritative during backfill', async () => {
      for (let index = 0; index < 10; index++) await insertEmbedding(1536, `concurrent-${index}`)
      await sql`DELETE FROM embedding_search`
      const writer = postgres(databaseUrl, {
        max: 1,
        connection: { search_path: `${schema},public` },
        onnotice: () => undefined,
      })
      try {
        await Promise.all([
          backfillEmbeddingSearch(sql),
          writer.begin(async (tx) => {
            await tx`UPDATE embedding SET embedding = NULL, embedding_384 = ${vector(384)}::vector WHERE id = 'concurrent-0'`
            await tx`DELETE FROM embedding WHERE id = 'concurrent-1'`
          }),
        ])
        expect(
          await sql`SELECT count(*)::int AS count FROM embedding e FULL JOIN embedding_search s USING(id)
          WHERE e.id IS NULL OR s.id IS NULL
            OR s.binary IS DISTINCT FROM binary_quantize(e.embedding)::bit(1536)
            OR s.binary_384 IS DISTINCT FROM binary_quantize(e.embedding_384)::bit(384)`
        ).toEqual([{ count: 0 }])
      } finally {
        await writer.end()
      }
    })
  })
})
