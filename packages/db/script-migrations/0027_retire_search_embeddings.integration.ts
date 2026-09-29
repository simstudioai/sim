import { retireSearchEmbeddingsMigration } from '@sim/db/script-migrations/0027_retire_search_embeddings'
import { ScriptMigrationDeferred } from '@sim/db/script-migrations/types'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** Proves destructive scope, cascading integrity, and atomic restart against real PostgreSQL. */
describe('retiring dormant Search embeddings', () => {
  const schema = `search_retirement_${generateId().replaceAll('-', '')}`
  let admin: Sql
  let sql: Sql

  beforeAll(async () => {
    admin = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schema}"`)
    sql = postgres(readTestDatabaseUrl(), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    await sql`CREATE TABLE knowledge_base (id text PRIMARY KEY, is_search_index boolean NOT NULL)`
    await sql`CREATE TABLE document (
      id text PRIMARY KEY, knowledge_base_id text REFERENCES knowledge_base(id),
      user_excluded boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true,
      processing_queue_token text, processing_queued_at timestamp, processing_deferred_until timestamp)`
    await sql`CREATE TABLE embedding (
      id text PRIMARY KEY, knowledge_base_id text REFERENCES knowledge_base(id),
      document_id text REFERENCES document(id))`
    await sql`CREATE TABLE embedding_search (id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
    await sql`CREATE TABLE embedding_keyword_search (id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
    await sql`CREATE TABLE embedding_keyword_tin (id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
    await sql`CREATE TABLE embedding_secret_provenance (embedding_id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await sql?.end()
    await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE knowledge_base, document, embedding, embedding_search,
      embedding_keyword_search, embedding_keyword_tin, embedding_secret_provenance`
    await sql`DROP TABLE IF EXISTS search_embedding_cleanup_progress`
    vi.stubEnv('SIM_SEARCH_LIVE', 'true')
    vi.stubEnv('SIM_SEARCH_PURGE_LEGACY_EMBEDDINGS', 'true')
    vi.stubEnv('SIM_SEARCH_CLEANUP_MAX_BATCHES', '1')
    vi.stubEnv('SIM_SEARCH_CLEANUP_KNOWLEDGE_BASE_ID', 'search')
    await sql`INSERT INTO knowledge_base VALUES ('search', true), ('ordinary', false), ('other-search', true)`
    await sql`INSERT INTO document (id, knowledge_base_id, processing_queue_token)
      VALUES ('search-doc', 'search', 'old-dispatch'), ('ordinary-doc', 'ordinary', 'keep-dispatch'),
        ('other-search-doc', 'other-search', 'keep-other-dispatch')`
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), CASE WHEN i % 2 = 0 THEN 'search' ELSE 'ordinary' END,
        CASE WHEN i % 2 = 0 THEN 'search-doc' ELSE 'ordinary-doc' END
      FROM generate_series(1, 1002) i`
    await sql`INSERT INTO embedding VALUES ('other-search-chunk', 'other-search', 'other-search-doc')`
    await sql`INSERT INTO embedding_search SELECT id FROM embedding`
    await sql`INSERT INTO embedding_keyword_search SELECT id FROM embedding`
    await sql`INSERT INTO embedding_keyword_tin SELECT id FROM embedding`
    await sql`INSERT INTO embedding_secret_provenance SELECT id FROM embedding`
  })

  async function pass() {
    try {
      await retireSearchEmbeddingsMigration.up(sql)
      return true
    } catch (error) {
      if (error instanceof ScriptMigrationDeferred) return false
      throw error
    }
  }

  it('requires explicit live mode and operator opt-in before changing any data', async () => {
    for (const [live, enabled] of [
      ['false', 'true'],
      ['', 'true'],
      ['true', 'false'],
    ]) {
      vi.stubEnv('SIM_SEARCH_LIVE', live)
      vi.stubEnv('SIM_SEARCH_PURGE_LEGACY_EMBEDDINGS', enabled)
      expect(await pass()).toBe(false)
      expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(1003)
      expect(
        (await sql`SELECT user_excluded FROM document WHERE id = 'search-doc'`)[0].user_excluded
      ).toBe(false)
    }
  })

  it('resumes bounded pages, cascades only Search chunks, and preserves configuration and ordinary documents', async () => {
    expect(await pass()).toBe(false)
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'search-doc'`
      )[0]
    ).toEqual({ user_excluded: true, processing_queue_token: null })
    let completed = false
    for (let attempt = 0; attempt < 10 && !completed; attempt++) completed = await pass()
    expect(completed).toBe(true)
    expect(
      (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0].n
    ).toBe(0)
    expect(
      (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'ordinary'`)[0]
        .n
    ).toBe(501)
    for (const table of [
      'embedding_search',
      'embedding_keyword_search',
      'embedding_keyword_tin',
      'embedding_secret_provenance',
    ]) {
      expect((await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n).toBe(502)
    }
    expect((await sql`SELECT count(*)::int AS n FROM knowledge_base`)[0].n).toBe(3)
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'other-search-doc'`
      )[0]
    ).toEqual({ user_excluded: false, processing_queue_token: 'keep-other-dispatch' })
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'ordinary-doc'`
      )[0]
    ).toEqual({ user_excluded: false, processing_queue_token: 'keep-dispatch' })
    expect(await pass()).toBe(true)
  })

  it('does not advance the durable cursor when a deletion fails', async () => {
    await pass()
    await pass()
    await sql`CREATE TABLE deletion_blocker (id text REFERENCES embedding(id))`
    await sql`INSERT INTO deletion_blocker VALUES ('00002')`
    const before = await sql`SELECT * FROM search_embedding_cleanup_progress`
    await expect(pass()).rejects.toThrow()
    expect(await sql`SELECT * FROM search_embedding_cleanup_progress`).toEqual(before)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(1003)
    await sql`DROP TABLE deletion_blocker`
    expect(await pass()).toBe(false)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(753)
  })

  it('rejects ordinary KB targets and refuses to switch targets on resume', async () => {
    vi.stubEnv('SIM_SEARCH_CLEANUP_KNOWLEDGE_BASE_ID', 'ordinary')
    await expect(pass()).rejects.toThrow('existing Search knowledge base')
    vi.stubEnv('SIM_SEARCH_CLEANUP_KNOWLEDGE_BASE_ID', 'search')
    await pass()
    vi.stubEnv('SIM_SEARCH_CLEANUP_KNOWLEDGE_BASE_ID', 'other-search')
    await expect(pass()).rejects.toThrow('Cannot change')
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(1003)
  })
})
