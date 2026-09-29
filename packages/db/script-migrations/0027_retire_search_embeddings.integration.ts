import { retireSearchEmbeddingsMigration } from '@sim/db/script-migrations/0027_retire_search_embeddings'
import { maintainSearchRetirementMigration } from '@sim/db/script-migrations/0028_maintain_search_retirement'
import { runScriptMigrations } from '@sim/db/script-migrations/index'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
    await sql`CREATE TABLE embedding_search (
      id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE,
      vector public.vector(3) NOT NULL DEFAULT '[1,2,3]')`
    await sql`CREATE TABLE embedding_keyword_search (id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
    await sql`CREATE TABLE embedding_keyword_tin (id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
    await sql`CREATE TABLE embedding_secret_provenance (embedding_id text PRIMARY KEY REFERENCES embedding(id) ON DELETE CASCADE)`
  })

  afterAll(async () => {
    await sql?.end()
    await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    await admin.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE knowledge_base, document, embedding, embedding_search,
      embedding_keyword_search, embedding_keyword_tin, embedding_secret_provenance`
    await sql`DROP TABLE IF EXISTS search_embedding_cleanup_progress`
    await sql`DROP TABLE IF EXISTS script_migrations`
    await sql`INSERT INTO knowledge_base VALUES ('search', true), ('ordinary', false)`
    await sql`INSERT INTO document (id, knowledge_base_id, processing_queue_token)
      VALUES ('search-doc', 'search', 'old-dispatch'), ('ordinary-doc', 'ordinary', 'keep-dispatch')`
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), CASE WHEN i % 2 = 0 THEN 'search' ELSE 'ordinary' END,
        CASE WHEN i % 2 = 0 THEN 'search-doc' ELSE 'ordinary-doc' END
      FROM generate_series(1, 1002) i`
    await sql`INSERT INTO embedding_search (id) SELECT id FROM embedding`
    await sql`INSERT INTO embedding_keyword_search SELECT id FROM embedding`
    await sql`INSERT INTO embedding_keyword_tin SELECT id FROM embedding`
    await sql`INSERT INTO embedding_secret_provenance SELECT id FROM embedding`
  })

  async function pass() {
    await runScriptMigrations(sql, [retireSearchEmbeddingsMigration])
    const receipts = await sql`SELECT name FROM script_migrations
      WHERE name = '0027_retire_search_embeddings'`
    return receipts.length === 1
  }

  it('does nothing without Search data and fails an ambiguous target without changing data', async () => {
    await sql`UPDATE knowledge_base SET is_search_index = false`
    expect(await pass()).toBe(true)
    await sql`DELETE FROM script_migrations`
    await sql`UPDATE knowledge_base SET is_search_index = true`
    await expect(pass()).rejects.toThrow('ambiguous')
    expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(1002)
    expect(
      (await sql`SELECT user_excluded FROM document WHERE id = 'search-doc'`)[0].user_excluded
    ).toBe(false)
  })

  it('cascades only Search chunks and preserves configuration and ordinary documents', async () => {
    expect(await pass()).toBe(true)
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'search-doc'`
      )[0]
    ).toEqual({ user_excluded: true, processing_queue_token: null })
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
      expect((await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n).toBe(501)
    }
    expect((await sql`SELECT count(*)::int AS n FROM knowledge_base`)[0].n).toBe(2)
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'ordinary-doc'`
      )[0]
    ).toEqual({ user_excluded: false, processing_queue_token: 'keep-dispatch' })
    expect(await pass()).toBe(true)
  })

  it('rolls back failed pages and resumes the frozen target, retiring documents inserted behind the cursor', async () => {
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 26002) i`
    await sql`CREATE TABLE deletion_blocker (id text REFERENCES embedding(id))`
    await sql`INSERT INTO deletion_blocker VALUES ('26002')`
    await expect(pass()).rejects.toThrow()
    const before = await sql`SELECT * FROM search_embedding_cleanup_progress`
    const [remaining] = await sql`SELECT count(*)::int AS n FROM embedding`
    expect(remaining.n).toBeGreaterThan(501)
    expect(remaining.n).toBeLessThan(26002)
    expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
    await expect(pass()).rejects.toThrow()
    expect(await sql`SELECT * FROM search_embedding_cleanup_progress`).toEqual(before)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(remaining.n)
    await sql`DROP TABLE deletion_blocker`
    await sql`INSERT INTO document (id, knowledge_base_id) VALUES ('aaa-late-document', 'search')`
    await sql`INSERT INTO embedding VALUES ('00000', 'search', 'aaa-late-document')`
    await sql`INSERT INTO knowledge_base VALUES ('other-search', true)`
    await sql`INSERT INTO document (id, knowledge_base_id, processing_queue_token)
      VALUES ('other-search-doc', 'other-search', 'keep-dispatch')`
    await sql`INSERT INTO embedding VALUES ('other-search-chunk', 'other-search', 'other-search-doc')`
    expect(await pass()).toBe(true)
    expect(
      (await sql`SELECT user_excluded FROM document WHERE id = 'aaa-late-document'`)[0]
        .user_excluded
    ).toBe(true)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(502)
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'other-search-doc'`
      )[0]
    ).toEqual({ user_excluded: false, processing_queue_token: 'keep-dispatch' })
  })

  it('finishes beyond the former page budget and journals completion in one invocation', async () => {
    await sql`INSERT INTO document (id, knowledge_base_id)
      SELECT 'bulk-doc-' || i::text, 'search' FROM generate_series(1, 51002) i`
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 51002) i`
    await runScriptMigrations(sql, [
      retireSearchEmbeddingsMigration,
      maintainSearchRetirementMigration,
    ])
    expect(await sql`SELECT name FROM script_migrations`).toHaveLength(2)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM document
        WHERE knowledge_base_id = 'search' AND (NOT user_excluded OR enabled)`
      )[0].n
    ).toBe(0)
  }, 60_000)

  it('rejects inconsistent document ownership before deleting any chunk in the page', async () => {
    await sql`UPDATE embedding SET document_id = 'ordinary-doc' WHERE id = '00002'`
    await expect(pass()).rejects.toThrow('Search content changed after retirement')
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(1002)
    expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
    await sql`UPDATE embedding SET document_id = 'search-doc' WHERE id = '00002'`
    expect(await pass()).toBe(true)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
  })

  it('retries a briefly locked document page and completes in the same invocation', async () => {
    const blocker = postgres(readTestDatabaseUrl(), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    let signalLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = blocker.begin(async (tx) => {
      await tx`SELECT id FROM document WHERE id = 'search-doc' FOR UPDATE`
      signalLocked()
      await released
    })
    try {
      await locked
      const result = pass().then(
        (complete) => ({ complete, error: undefined }),
        (error: unknown) => ({ complete: false, error })
      )
      await sleep(1_500)
      release()
      await holding
      expect(await result).toEqual({ complete: true, error: undefined })
      expect(
        (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0]
          .n
      ).toBe(0)
    } finally {
      release()
      await holding
      await blocker.end()
    }
  })

  it('maintains an already-retired index and resumes failed vacuum bookkeeping without rebuilding it again', async () => {
    await pass()
    await sql`CREATE INDEX retirement_hnsw_idx ON embedding_search USING hnsw (vector public.vector_l2_ops)`
    const [original] = await sql`SELECT to_regclass('retirement_hnsw_idx')::oid AS oid`
    await sql`CREATE FUNCTION interrupt_maintenance_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.vacuumed_tables = 2 THEN RAISE EXCEPTION 'interrupt maintenance checkpoint'; END IF;
        RETURN NEW;
      END $$`
    await sql`CREATE TRIGGER interrupt_maintenance_checkpoint BEFORE UPDATE ON search_embedding_cleanup_progress
      FOR EACH ROW EXECUTE FUNCTION interrupt_maintenance_checkpoint()`
    try {
      await expect(runScriptMigrations(sql, [maintainSearchRetirementMigration])).rejects.toThrow(
        'interrupt maintenance checkpoint'
      )
      const [rebuilt] =
        await sql`SELECT c.oid, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.oid = to_regclass('retirement_hnsw_idx')`
      expect(rebuilt.oid).not.toBe(original.oid)
      expect(rebuilt.indisvalid).toBe(true)
      expect(
        await sql`SELECT reindexed_through, vacuumed_tables FROM search_embedding_cleanup_progress`
      ).toEqual([{ reindexed_through: 'retirement_hnsw_idx', vacuumed_tables: 1 }])
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0028_maintain_search_retirement'`
      ).toHaveLength(0)
      await sql`DROP TRIGGER interrupt_maintenance_checkpoint ON search_embedding_cleanup_progress`
      await runScriptMigrations(sql, [maintainSearchRetirementMigration])
      expect((await sql`SELECT to_regclass('retirement_hnsw_idx')::oid AS oid`)[0].oid).toBe(
        rebuilt.oid
      )
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0028_maintain_search_retirement'`
      ).toHaveLength(1)
      expect(
        (
          await sql`SELECT reltuples::int AS n FROM pg_class WHERE oid = to_regclass('embedding_search')`
        )[0].n
      ).toBe(501)
      await runScriptMigrations(sql, [maintainSearchRetirementMigration])
      expect((await sql`SELECT to_regclass('retirement_hnsw_idx')::oid AS oid`)[0].oid).toBe(
        rebuilt.oid
      )
    } finally {
      await sql`DROP TRIGGER IF EXISTS interrupt_maintenance_checkpoint ON search_embedding_cleanup_progress`
      await sql`DROP FUNCTION interrupt_maintenance_checkpoint()`
      await sql`DROP INDEX retirement_hnsw_idx`
    }
  })

  it('recovers a canceled concurrent rebuild and completes cleanup plus maintenance in one rerun', async () => {
    await sql`CREATE INDEX retirement_hnsw_idx ON embedding_search USING hnsw (vector public.vector_l2_ops)`
    const blocker = postgres(readTestDatabaseUrl(), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    let signalLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = blocker.begin(async (tx) => {
      await tx`UPDATE embedding_search SET vector = '[3,2,1]' WHERE id = '00001'`
      signalLocked()
      await released
    })
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    const migrations = [retireSearchEmbeddingsMigration, maintainSearchRetirementMigration]
    let outcome: Promise<unknown> | undefined
    try {
      await locked
      outcome = runScriptMigrations(sql, migrations).then(
        () => undefined,
        (error: unknown) => error
      )
      let waiting = false
      for (let attempt = 0; attempt < 200; attempt++) {
        const [progress] =
          await admin`SELECT phase FROM pg_stat_progress_create_index WHERE pid = ${pid}`
        if (progress?.phase === 'waiting for writers before build') {
          waiting = true
          break
        }
        await sleep(25)
      }
      expect(waiting).toBe(true)
      await admin`SELECT pg_cancel_backend(${pid})`
      expect(await outcome).toMatchObject({ code: '57014' })
      release()
      await holding
      const leftovers =
        await sql`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = to_regclass('embedding_search') AND NOT i.indisvalid`
      expect(leftovers.length).toBeGreaterThan(0)
      expect(
        (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0]
          .n
      ).toBe(0)
      await runScriptMigrations(sql, migrations)
      expect(
        await sql`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = to_regclass('embedding_search') AND NOT i.indisvalid`
      ).toHaveLength(0)
      expect((await sql`SELECT count(*)::int AS n FROM embedding_search`)[0].n).toBe(501)
      expect(
        await sql`SELECT name FROM script_migrations WHERE name = '0028_maintain_search_retirement'`
      ).toHaveLength(1)
    } finally {
      release()
      await holding
      await admin`SELECT pg_cancel_backend(${pid})`
      await outcome
      await blocker.end()
      await sql`DROP INDEX retirement_hnsw_idx`
    }
  })
})
