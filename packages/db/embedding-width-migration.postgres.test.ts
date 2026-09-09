import { readFile } from 'node:fs/promises'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
const SUPPORTED_WIDTHS = [384, 768, 1024, 1536, 3072] as const
type EmbeddingWidth = (typeof SUPPORTED_WIDTHS)[number]

/** Replays the historical vector DDL so db-push cannot hide migration-only constraints. */
describe.runIf(Boolean(databaseUrl))('embedding width migration in PostgreSQL', () => {
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
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/sim_acl_test')
    ) {
      throw new Error('Embedding migration tests require a disposable local sim_acl_test database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schema}"`)
    sql = postgres(url.toString(), {
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
      new URL('./migrations/0333_embedding_width_nullable.sql', import.meta.url),
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
    await sql`TRUNCATE embedding`
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
})
