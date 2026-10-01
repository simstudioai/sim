import {
  type RetirementThrottle,
  retireSearchEmbeddings,
} from '@sim/db/script-migrations/0027_retire_search_embeddings'
import { maintainSearchRetirementMigration } from '@sim/db/script-migrations/0028_maintain_search_retirement'
import { searchRetirementSlice } from '@sim/db/script-migrations/0029_retire_all_search_embeddings'
import { runScriptMigrations, scriptMigrations } from '@sim/db/script-migrations/index'
import { type ScriptMigration, ScriptMigrationDeferred } from '@sim/db/script-migrations/types'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Pages back to back, for the suites about scope and recovery rather than pacing. A local database's
 * small `max_wal_size` would otherwise pace even these tiny fixtures for seconds per page.
 */
const UNTHROTTLED: Partial<RetirementThrottle> = {
  dutyRatio: 0,
  walBudgetShare: Number.POSITIVE_INFINITY,
}

/** The retirement alone, run to completion under its own journal name. */
const retireToCompletion: ScriptMigration = {
  name: '0027_retire_search_embeddings',
  async up(sql) {
    if ((await retireSearchEmbeddings(sql, { throttle: UNTHROTTLED })) === 'deferred') {
      throw new ScriptMigrationDeferred('Another Search retirement runner holds the lock')
    }
  },
}

/** The background runner's slice without a budget: retirement and maintenance to completion. */
const backgroundRun = searchRetirementSlice({
  budgetMs: Number.POSITIVE_INFINITY,
  maintenance: true,
  throttle: UNTHROTTLED,
})

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
      /** Fixtures alternate legacy and upgraded table layouts on this connection. */
      prepare: false,
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
    await sql`DROP TABLE IF EXISTS search_embedding_cleanup_targets`
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
    await runScriptMigrations(sql, [retireToCompletion])
    const receipts = await sql`SELECT name FROM script_migrations
      WHERE name = '0027_retire_search_embeddings'`
    return receipts.length === 1
  }

  it('does nothing without Search data', async () => {
    await sql`UPDATE knowledge_base SET is_search_index = false`
    expect(await pass()).toBe(true)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(1002)
    expect(
      (await sql`SELECT user_excluded FROM document WHERE id = 'search-doc'`)[0].user_excluded
    ).toBe(false)
  })

  it('retires every Search KB while preserving configuration and ordinary documents', async () => {
    await sql`INSERT INTO knowledge_base VALUES ('second-search', true), ('empty-search', true)`
    await sql`INSERT INTO document (id, knowledge_base_id, processing_queue_token)
      VALUES ('second-search-doc', 'second-search', 'old-dispatch')`
    await sql`INSERT INTO embedding VALUES
      ('00000', 'second-search', 'second-search-doc'), ('zz-last', 'second-search', 'second-search-doc')`
    await sql`INSERT INTO embedding_search (id) VALUES ('00000'), ('zz-last')`
    await sql`INSERT INTO embedding_keyword_search VALUES ('00000'), ('zz-last')`
    await sql`INSERT INTO embedding_keyword_tin VALUES ('00000'), ('zz-last')`
    await sql`INSERT INTO embedding_secret_provenance VALUES ('00000'), ('zz-last')`
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
    expect((await sql`SELECT count(*)::int AS n FROM knowledge_base`)[0].n).toBe(4)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
    expect(
      (
        await sql`SELECT user_excluded, enabled, processing_queue_token FROM document
        WHERE id = 'second-search-doc'`
      )[0]
    ).toEqual({ user_excluded: true, enabled: false, processing_queue_token: null })
    expect(
      (
        await sql`SELECT user_excluded, processing_queue_token FROM document WHERE id = 'ordinary-doc'`
      )[0]
    ).toEqual({ user_excluded: false, processing_queue_token: 'keep-dispatch' })
    expect(await pass()).toBe(true)
  })

  it.each([
    { phase: 'documents', legacy: 'present', otherSearch: true },
    { phase: 'embeddings', legacy: 'present', otherSearch: true },
    { phase: 'done', legacy: 'present', otherSearch: true },
    { phase: 'done', legacy: 'deleted', otherSearch: true },
    { phase: 'done', legacy: 'ordinary', otherSearch: true },
    { phase: 'done', legacy: 'deleted', otherSearch: false },
  ] as const)(
    'upgrades a legacy $phase checkpoint with a $legacy KB (other Search KBs: $otherSearch)',
    async ({ phase, legacy, otherSearch }) => {
      if (otherSearch) {
        await sql`INSERT INTO knowledge_base VALUES ('second-search', true)`
        await sql`INSERT INTO document (id, knowledge_base_id)
          VALUES ('aaa-second-doc', 'second-search')`
        await sql`INSERT INTO embedding VALUES ('00000', 'second-search', 'aaa-second-doc')`
        await sql`INSERT INTO embedding_search (id) VALUES ('00000')`
      }
      await sql`UPDATE document SET user_excluded = true, enabled = false,
        processing_queue_token = NULL WHERE knowledge_base_id = 'search'`
      await sql`CREATE TABLE search_embedding_cleanup_progress (
        id integer PRIMARY KEY CHECK (id = 1), knowledge_base_id text NOT NULL,
        phase text NOT NULL CHECK (phase IN ('documents', 'embeddings', 'done')),
        after_id text NOT NULL, reindexed_through text NOT NULL DEFAULT '',
        vacuumed_tables integer NOT NULL DEFAULT 0)`
      await sql`INSERT INTO search_embedding_cleanup_progress
        VALUES (1, 'search', ${phase}, ${phase === 'documents' ? 'search-doc' : '00050'}, 'legacy_hnsw_idx', 6)`
      await sql`CREATE INDEX legacy_hnsw_idx ON embedding_search USING hnsw (vector public.vector_l2_ops)`
      const [original] = await sql`SELECT to_regclass('legacy_hnsw_idx')::oid AS oid`
      await sql`CREATE TABLE script_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`
      if (phase === 'embeddings') {
        await sql`DELETE FROM embedding WHERE knowledge_base_id = 'search' AND id <= '00050'`
      }
      if (phase === 'done') {
        await sql`DELETE FROM embedding WHERE knowledge_base_id = 'search'`
        await sql`INSERT INTO script_migrations (name)
          VALUES ('0027_retire_search_embeddings'), ('0028_maintain_search_retirement')`
      }
      if (legacy === 'deleted') {
        await sql`DELETE FROM document WHERE knowledge_base_id = 'search'`
        await sql`DELETE FROM knowledge_base WHERE id = 'search'`
      } else if (legacy === 'ordinary') {
        await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'search'`
        await sql`UPDATE document SET user_excluded = false, enabled = true,
          processing_queue_token = 'keep-dispatch' WHERE id = 'search-doc'`
        await sql`INSERT INTO embedding VALUES ('new-ordinary-chunk', 'search', 'search-doc')`
        await sql`INSERT INTO embedding_search (id) VALUES ('new-ordinary-chunk')`
      }
      const migrations = scriptMigrations.filter((migration) =>
        [
          '0027_retire_search_embeddings',
          '0028_maintain_search_retirement',
          '0029_retire_all_search_embeddings',
        ].includes(migration.name)
      )
      const journaled = async () =>
        (
          await sql`SELECT name FROM script_migrations WHERE name = '0029_retire_all_search_embeddings'`
        ).length === 1
      try {
        /** The deploy slice retires within its budget but leaves rebuilds to the background runner. */
        await runScriptMigrations(sql, migrations)
        const preserved = legacy === 'ordinary' ? 502 : 501
        expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(preserved)
        expect((await sql`SELECT count(*)::int AS n FROM embedding_search`)[0].n).toBe(preserved)
        expect((await sql`SELECT to_regclass('legacy_hnsw_idx')::oid AS oid`)[0].oid).toBe(
          original.oid
        )
        expect(await journaled()).toBe(!otherSearch)
        await runScriptMigrations(sql, [backgroundRun])
        if (otherSearch) {
          expect(
            (await sql`SELECT user_excluded, enabled FROM document WHERE id = 'aaa-second-doc'`)[0]
          ).toEqual({ user_excluded: true, enabled: false })
        }
        if (legacy === 'ordinary') {
          expect(
            (
              await sql`SELECT user_excluded, enabled, processing_queue_token FROM document WHERE id = 'search-doc'`
            )[0]
          ).toEqual({
            user_excluded: false,
            enabled: true,
            processing_queue_token: 'keep-dispatch',
          })
        }
        const [rebuilt] = await sql`SELECT to_regclass('legacy_hnsw_idx')::oid AS oid`
        if (otherSearch) expect(rebuilt.oid).not.toBe(original.oid)
        else expect(rebuilt.oid).toBe(original.oid)
        expect(await journaled()).toBe(true)
        await runScriptMigrations(sql, migrations)
        expect((await sql`SELECT to_regclass('legacy_hnsw_idx')::oid AS oid`)[0].oid).toBe(
          rebuilt.oid
        )
      } finally {
        await sql`DROP INDEX legacy_hnsw_idx`
      }
    }
  )

  it.each(['embeddings', 'done'] as const)(
    'rejects changed markers outside the current page when resuming %s',
    async (phase) => {
      await sql`INSERT INTO knowledge_base VALUES ('empty-search', true)`
      if (phase === 'done') {
        await pass()
        await sql`DELETE FROM script_migrations`
        await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'empty-search'`
      }
      await sql`CREATE FUNCTION change_empty_search_marker() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE knowledge_base SET is_search_index = false WHERE id = 'empty-search';
          RETURN NULL;
        END $$`
      await sql`CREATE TRIGGER change_empty_search_marker AFTER DELETE ON embedding
        FOR EACH STATEMENT EXECUTE FUNCTION change_empty_search_marker()`
      try {
        await expect(pass()).rejects.toThrow('no longer a Search knowledge base')
        expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
        expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
        await sql`DROP TRIGGER change_empty_search_marker ON embedding`
        await sql`UPDATE knowledge_base SET is_search_index = true WHERE id = 'empty-search'`
        expect(await pass()).toBe(true)
        expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
      } finally {
        await sql`DROP TRIGGER IF EXISTS change_empty_search_marker ON embedding`
        await sql`DROP FUNCTION change_empty_search_marker()`
      }
    }
  )

  it('rolls back failed pages, rechecks every target marker, and resumes the frozen scope', async () => {
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 26002) i`
    await sql`INSERT INTO knowledge_base VALUES ('second-search', true)`
    await sql`INSERT INTO document (id, knowledge_base_id) VALUES ('second-search-doc', 'second-search')`
    await sql`INSERT INTO embedding VALUES ('26003', 'second-search', 'second-search-doc')`
    await sql`CREATE TABLE deletion_blocker (id text REFERENCES embedding(id))`
    await sql`INSERT INTO deletion_blocker VALUES ('26002')`
    /**
     * Pages split by mutated rows under an adaptive limit, so how far each failed run gets depends
     * on page geometry. The geometry-free invariant: every committed delete sits at or behind the
     * cursor, and a failed page leaves every row past it (IDs 00001-26003 are contiguous).
     */
    async function expectRolledBackPastCursor() {
      const [progress] = await sql`SELECT phase, after_id FROM search_embedding_cleanup_progress`
      expect(progress.phase).toBe('embeddings')
      const [beyond] =
        await sql`SELECT count(*)::int AS n FROM embedding WHERE id > ${progress.after_id}`
      expect(beyond.n).toBe(26003 - Number(progress.after_id))
      expect(progress.after_id < '26002').toBe(true)
    }
    await expect(pass()).rejects.toThrow()
    const [remaining] = await sql`SELECT count(*)::int AS n FROM embedding`
    expect(remaining.n).toBeGreaterThan(501)
    expect(remaining.n).toBeLessThan(26002)
    expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
    await expectRolledBackPastCursor()
    await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'second-search'`
    await expect(pass()).rejects.toThrow('no longer a Search knowledge base')
    await expectRolledBackPastCursor()
    await sql`UPDATE knowledge_base SET is_search_index = true WHERE id = 'second-search'`
    await expect(pass()).rejects.toThrow()
    await expectRolledBackPastCursor()
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

  it('finishes in one unbounded background invocation and journals completion', async () => {
    await sql`INSERT INTO document (id, knowledge_base_id)
      SELECT 'bulk-doc-' || i::text, 'search' FROM generate_series(1, 51002) i`
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 51002) i`
    await runScriptMigrations(sql, [backgroundRun])
    expect(await sql`SELECT name FROM script_migrations`).toHaveLength(3)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM document
        WHERE knowledge_base_id = 'search' AND (NOT user_excluded OR enabled)`
      )[0].n
    ).toBe(0)
  }, 60_000)

  it('splits pages whose writes would outrun the statement timeout and resumes at the split', async () => {
    const bound = 300
    await sql`INSERT INTO document (id, knowledge_base_id, user_excluded, enabled)
      SELECT 'doc-' || lpad(i::text, 5, '0'), CASE WHEN i % 3 = 0 THEN 'ordinary' ELSE 'search' END,
        i % 7 = 0, i % 7 <> 0
      FROM generate_series(1, 4000) i`
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), CASE WHEN i % 3 = 0 THEN 'ordinary' ELSE 'search' END,
        CASE WHEN i % 3 = 0 THEN 'ordinary-doc' ELSE 'search-doc' END
      FROM generate_series(1003, 5002) i`
    await sql`CREATE TABLE committed_statement (rows integer NOT NULL)`
    /** Sequences are not transactional, so this counts the timed-out statements that rolled back. */
    await sql`CREATE SEQUENCE timed_out_statement`
    /** Stands in for write cost: a statement touching more than `bound` rows times out and rolls back. */
    await sql.unsafe(`CREATE FUNCTION bound_statement_rows() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE touched integer;
      BEGIN
        SELECT count(*) INTO touched FROM changed_rows;
        IF touched > ${bound} THEN
          PERFORM nextval('timed_out_statement');
          RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
        END IF;
        INSERT INTO committed_statement VALUES (touched);
        RETURN NULL;
      END $$`)
    await sql`CREATE TRIGGER bound_document_update AFTER UPDATE ON document
      REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bound_statement_rows()`
    await sql`CREATE TRIGGER bound_embedding_delete AFTER DELETE ON embedding
      REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bound_statement_rows()`
    try {
      expect(await pass()).toBe(true)
      const [{ largest, total }] = await sql`SELECT max(rows)::int AS largest,
        sum(rows)::int AS total FROM committed_statement`
      expect(largest).toBeLessThanOrEqual(bound)
      expect(largest).toBeGreaterThan(0)
      /**
       * The limit halves 2,000 → 1,000 → 500 → 250 on the first document page and never grows back
       * to a size that timed out, in either phase: exactly three rolled-back statements. A page
       * that read past its row limit in either phase would time out again.
       */
      const [{ timeouts }] = await sql`SELECT last_value::int AS timeouts FROM timed_out_statement`
      expect(timeouts).toBe(3)
      /**
       * Documents: i % 3 <> 0 gives 2,667 Search rows, of which i % 7 = 0 leaves 381 retired, so
       * 2,286 are updated, plus `search-doc`. Chunks: 501 Search rows from the fixture plus the
       * 2,667 with i % 3 <> 0 among 1003-5002. Equality proves no row was mutated twice.
       */
      expect(total).toBe(2287 + 3168)
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM document
          WHERE knowledge_base_id = 'search' AND (NOT user_excluded OR enabled)`
        )[0].n
      ).toBe(0)
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM document
          WHERE knowledge_base_id = 'ordinary' AND NOT user_excluded AND enabled`
        )[0].n
        /** `ordinary-doc` plus the 1,333 i % 3 = 0 rows, less the 190 of them seeded retired. */
      ).toBe(1 + 1333 - 190)
      expect(
        (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0]
          .n
      ).toBe(0)
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'ordinary'`
        )[0].n
        /** 501 fixture chunks plus the 1,333 i % 3 = 0 rows among 1003-5002. */
      ).toBe(501 + 1333)
    } finally {
      await sql`DROP TRIGGER IF EXISTS bound_document_update ON document`
      await sql`DROP TRIGGER IF EXISTS bound_embedding_delete ON embedding`
      await sql`DROP FUNCTION bound_statement_rows()`
      await sql`DROP TABLE committed_statement`
      await sql`DROP SEQUENCE timed_out_statement`
    }
  }, 60_000)

  it('bounds the IDs each page reads by the row limit once the limit shrinks', async () => {
    const docs = 3000
    const bound = 25
    await sql`INSERT INTO document (id, knowledge_base_id)
      SELECT 'doc-' || lpad(i::text, 5, '0'), 'search' FROM generate_series(1, ${docs}) i`
    /** Statements over `bound` rows time out, which pins the row limit at its 25-row floor. */
    await sql.unsafe(`CREATE FUNCTION bound_document_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT count(*) FROM changed_rows) > ${bound} THEN
          RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
        END IF;
        RETURN NULL;
      END $$`)
    await sql`CREATE TRIGGER bound_document_update AFTER UPDATE ON document
      REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION bound_document_update()`
    /**
     * On a table this small the planner may answer any page with a sequential scan, which reads
     * every row whatever the window; production pages use the primary key, so the test does too.
     */
    await sql`SET enable_seqscan = off`
    /** Document rows read by any scan, counted across committed and rolled-back pages alike. */
    async function documentReads() {
      await sql`SELECT pg_stat_force_next_flush()`
      await admin`SELECT pg_stat_clear_snapshot()`
      const [row] = await admin`SELECT (seq_tup_read + coalesce(idx_tup_fetch, 0))::int AS n
        FROM pg_stat_user_tables WHERE schemaname = ${schema} AND relname = 'document'`
      return row.n
    }
    try {
      const before = await documentReads()
      expect(await pass()).toBe(true)
      const reads = (await documentReads()) - before
      /**
       * About 120 pages retire the 3,001 documents 25 at a time once the limit has halved down to
       * its floor. A window of four IDs per row reads about 100 IDs and 25 update lookups per page,
       * roughly 5 reads per document, plus the chunk phase and completion rechecks. A fixed
       * 25,000-ID window re-reads the rest of the table on every attempt, over 100 per document.
       */
      expect(reads).toBeLessThan(30 * docs)
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM document
          WHERE knowledge_base_id = 'search' AND (NOT user_excluded OR enabled)`
        )[0].n
      ).toBe(0)
    } finally {
      await sql`RESET enable_seqscan`
      await sql`DROP TRIGGER IF EXISTS bound_document_update ON document`
      await sql`DROP FUNCTION bound_document_update()`
    }
  }, 120_000)

  it('gives the completed-retirement recheck the completion timeout when it resumes', async () => {
    expect(await pass()).toBe(true)
    await sql`DELETE FROM script_migrations`
    /** Stands in for a recheck that outlasts the two-minute page timeout on a large target set. */
    await sql`CREATE FUNCTION require_recheck_timeout() RETURNS boolean LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('statement_timeout') <> '30min' THEN
          RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
        END IF;
        RETURN true;
      END $$`
    await sql`ALTER TABLE search_embedding_cleanup_targets RENAME TO captured_targets`
    await sql`CREATE VIEW search_embedding_cleanup_targets AS
      SELECT knowledge_base_id FROM captured_targets WHERE require_recheck_timeout()`
    try {
      expect(await sql`SELECT phase FROM search_embedding_cleanup_progress`).toEqual([
        { phase: 'done' },
      ])
      expect(await pass()).toBe(true)
    } finally {
      await sql`DROP VIEW IF EXISTS search_embedding_cleanup_targets`
      await sql`ALTER TABLE IF EXISTS captured_targets RENAME TO search_embedding_cleanup_targets`
      await sql`DROP FUNCTION require_recheck_timeout()`
    }
  })

  it('scans past a run of already-retired documents longer than the row limit in one page', async () => {
    /** 6,000 retired Search documents exceed the initial 2,000-row limit but fit one 25,000-ID scan. */
    await sql`INSERT INTO document (id, knowledge_base_id, user_excluded, enabled)
      SELECT 'doc-' || lpad(i::text, 5, '0'), 'search', true, false FROM generate_series(1, 6000) i`
    await sql`INSERT INTO document (id, knowledge_base_id)
      SELECT 'doc-' || lpad(i::text, 5, '0'), 'search' FROM generate_series(6001, 6010) i`
    await sql`CREATE SEQUENCE document_page_statements`
    await sql`CREATE FUNCTION count_document_page() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM nextval('document_page_statements');
        RETURN NULL;
      END $$`
    /** Statement triggers fire even for zero rows, so this counts every documents-phase page. */
    await sql`CREATE TRIGGER count_document_page AFTER UPDATE ON document
      FOR EACH STATEMENT EXECUTE FUNCTION count_document_page()`
    try {
      expect(await pass()).toBe(true)
      /** One page retires the 11 unretired rows (10 bulk plus `search-doc`); one more finds the end. */
      expect((await sql`SELECT last_value::int AS n FROM document_page_statements`)[0].n).toBe(2)
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM document
          WHERE knowledge_base_id = 'search' AND (NOT user_excluded OR enabled)`
        )[0].n
      ).toBe(0)
    } finally {
      await sql`DROP TRIGGER IF EXISTS count_document_page ON document`
      await sql`DROP FUNCTION count_document_page()`
      await sql`DROP SEQUENCE document_page_statements`
    }
  })

  it('fails at once on a timeout outside the page mutation instead of shrinking the page', async () => {
    await sql`CREATE SEQUENCE completion_attempts`
    /** Times out the completion checkpoint, a statement no smaller row limit can speed up. */
    await sql`CREATE FUNCTION time_out_completion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM nextval('completion_attempts');
        RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';
      END $$`
    await sql`CREATE TABLE search_embedding_cleanup_progress (
      id integer PRIMARY KEY CHECK (id = 1), knowledge_base_id text NOT NULL,
      phase text NOT NULL CHECK (phase IN ('documents', 'embeddings', 'done')),
      after_id text NOT NULL)`
    await sql`CREATE TRIGGER time_out_completion BEFORE UPDATE ON search_embedding_cleanup_progress
      FOR EACH ROW WHEN (NEW.phase = 'done') EXECUTE FUNCTION time_out_completion()`
    try {
      await expect(pass()).rejects.toMatchObject({ code: '57014' })
      /** The sequence is not transactional, so it counts rolled-back attempts too. */
      expect((await sql`SELECT last_value::int AS n FROM completion_attempts`)[0].n).toBe(1)
      expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
      expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(501)
      await sql`DROP TRIGGER time_out_completion ON search_embedding_cleanup_progress`
      expect(await pass()).toBe(true)
    } finally {
      await sql`DROP TRIGGER IF EXISTS time_out_completion ON search_embedding_cleanup_progress`
      await sql`DROP FUNCTION time_out_completion()`
      await sql`DROP SEQUENCE completion_attempts`
    }
  })

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
    const migrations = [retireToCompletion, maintainSearchRetirementMigration]
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

  /** A cleanup progress row in its pre-maintenance layout, so a test can attach triggers first. */
  async function createLegacyProgressTable() {
    await sql`CREATE TABLE search_embedding_cleanup_progress (
      id integer PRIMARY KEY CHECK (id = 1), knowledge_base_id text NOT NULL,
      phase text NOT NULL CHECK (phase IN ('documents', 'embeddings', 'done')),
      after_id text NOT NULL)`
  }

  /** Records each chunk delete statement's time, rows and smallest ID. */
  async function recordDeleteStatements() {
    await sql`CREATE TABLE delete_statement (at timestamptz NOT NULL, rows integer NOT NULL, min_id text)`
    await sql`CREATE FUNCTION record_delete_statement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO delete_statement
          SELECT clock_timestamp(), count(*), min(id) FROM removed HAVING count(*) > 0;
        RETURN NULL;
      END $$`
    await sql`CREATE TRIGGER record_delete_statement AFTER DELETE ON embedding
      REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION record_delete_statement()`
  }

  async function dropDeleteStatements() {
    await sql`DROP TRIGGER IF EXISTS record_delete_statement ON embedding`
    await sql`DROP FUNCTION IF EXISTS record_delete_statement()`
    await sql`DROP TABLE IF EXISTS delete_statement`
  }

  async function deleteStatements() {
    return sql<{ at: Date; rows: number; min_id: string }[]>`
      SELECT at, rows, min_id FROM delete_statement ORDER BY at`
  }

  it('defers the deploy slice within its budget, then the background runner resumes the cursor and journals', async () => {
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 40002) i`
    await createLegacyProgressTable()
    /** Every page commit waits, as a synchronous-replication round trip would. */
    await sql`CREATE FUNCTION wait_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(0.2);
        RETURN NULL;
      END $$`
    await sql`CREATE CONSTRAINT TRIGGER wait_at_commit AFTER UPDATE ON search_embedding_cleanup_progress
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wait_at_commit()`
    await recordDeleteStatements()
    const lock = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => undefined })
    try {
      const budgetMs = 1_000
      const deploy = searchRetirementSlice({ budgetMs, maintenance: false })
      const startedAt = performance.now()
      await runScriptMigrations(sql, [deploy])
      /** No page starts after the budget, so only the page in flight at the deadline may overrun it. */
      expect(performance.now() - startedAt).toBeLessThan(budgetMs + 2_000)
      expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)
      const [saved] = await sql`SELECT phase, after_id FROM search_embedding_cleanup_progress`
      expect(saved.phase).toBe('embeddings')
      expect(saved.after_id > '').toBe(true)
      const [{ remaining }] = await sql`SELECT count(*)::int AS remaining FROM embedding
        WHERE knowledge_base_id = 'search'`
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThan(39_501)

      /** While another runner holds the retirement lock, a deploy slice defers without a page. */
      await lock`SELECT pg_advisory_lock(hashtextextended('sim:search-retirement', 0))`
      await runScriptMigrations(sql, [deploy])
      await lock`SELECT pg_advisory_unlock(hashtextextended('sim:search-retirement', 0))`
      expect(await sql`SELECT phase, after_id FROM search_embedding_cleanup_progress`).toEqual([
        saved,
      ])
      expect(await sql`SELECT name FROM script_migrations`).toHaveLength(0)

      await sql`TRUNCATE delete_statement`
      await runScriptMigrations(sql, [backgroundRun])
      /** The background run picks up at the saved cursor rather than rescanning from the start. */
      const resumed = await deleteStatements()
      expect(resumed.length).toBeGreaterThan(0)
      for (const statement of resumed) expect(statement.min_id > saved.after_id).toBe(true)
      expect(
        (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0]
          .n
      ).toBe(0)
      expect(
        (await sql`SELECT name FROM script_migrations ORDER BY name`).map((row) => row.name)
      ).toEqual([
        '0027_retire_search_embeddings',
        '0028_maintain_search_retirement',
        '0029_retire_all_search_embeddings',
      ])
    } finally {
      await lock.end()
      await dropDeleteStatements()
      await sql`DROP TRIGGER IF EXISTS wait_at_commit ON search_embedding_cleanup_progress`
      await sql`DROP FUNCTION wait_at_commit()`
    }
  }, 60_000)

  it('halves the page and backs off exponentially while commits are slow', async () => {
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 12002) i`
    await createLegacyProgressTable()
    await sql`CREATE SEQUENCE slow_commits`
    /** The first two chunk pages wait at commit, as a stalled synchronous standby would make them. */
    await sql`CREATE FUNCTION slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.phase = 'embeddings' AND NEW.after_id <> '' THEN
          IF nextval('slow_commits') <= 2 THEN PERFORM pg_sleep(0.3); END IF;
        END IF;
        RETURN NULL;
      END $$`
    await sql`CREATE CONSTRAINT TRIGGER slow_commit AFTER UPDATE ON search_embedding_cleanup_progress
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slow_commit()`
    await recordDeleteStatements()
    const backoffMs = 1_000
    try {
      expect(
        await retireSearchEmbeddings(sql, {
          throttle: { ...UNTHROTTLED, slowCommitMs: 150, backoffMs },
        })
      ).toBe('complete')
      const statements = await deleteStatements()
      /** Halved after each slow commit, then growing again once commits recover. */
      const rows = statements.slice(0, 4).map((statement) => statement.rows)
      expect(rows).toEqual([rows[0], rows[0] / 2, rows[0] / 4, rows[0] / 2])
      const gap = (index: number) =>
        statements[index].at.getTime() - statements[index - 1].at.getTime()
      /** Each gap holds the slow commit plus a back-off that doubles while commits stay slow. */
      expect(gap(1)).toBeGreaterThanOrEqual(300 + backoffMs)
      expect(gap(2)).toBeGreaterThanOrEqual(300 + 2 * backoffMs)
      expect(gap(3)).toBeLessThan(backoffMs)
      expect(
        (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0]
          .n
      ).toBe(0)
    } finally {
      await dropDeleteStatements()
      await sql`DROP TRIGGER IF EXISTS slow_commit ON search_embedding_cleanup_progress`
      await sql`DROP FUNCTION slow_commit()`
      await sql`DROP SEQUENCE slow_commits`
    }
  }, 60_000)

  it('paces pages so the database WAL rate stays within the budget', async () => {
    await sql`INSERT INTO embedding
      SELECT lpad(i::text, 5, '0'), 'search', 'search-doc' FROM generate_series(1003, 40002) i`
    await sql`INSERT INTO embedding_search (id) SELECT id FROM embedding WHERE id > '01002'`
    /** Where each chunk delete statement starts and ends, in time and in WAL. */
    await sql`CREATE TABLE delete_bound (at timestamptz NOT NULL, lsn pg_lsn NOT NULL)`
    await sql`CREATE FUNCTION record_delete_bound() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO delete_bound VALUES (clock_timestamp(), pg_current_wal_insert_lsn());
        RETURN NULL;
      END $$`
    await sql`CREATE TRIGGER record_delete_start BEFORE DELETE ON embedding
      FOR EACH STATEMENT EXECUTE FUNCTION record_delete_bound()`
    await sql`CREATE TRIGGER record_delete_end AFTER DELETE ON embedding
      FOR EACH STATEMENT EXECUTE FUNCTION record_delete_bound()`
    const [settings] = await sql<{ max_wal_bytes: number; checkpoint_ms: number }[]>`
      SELECT pg_size_bytes(current_setting('max_wal_size'))::float8 AS max_wal_bytes,
        (extract(epoch FROM current_setting('checkpoint_timeout')::interval) * 1000)::float8 AS checkpoint_ms`
    /** 1 MB/s, far below what back-to-back pages write locally. */
    const budgetBytesPerMs = 1_000
    const walBudgetShare = (budgetBytesPerMs * settings.checkpoint_ms) / settings.max_wal_bytes
    try {
      expect(
        await retireSearchEmbeddings(sql, { throttle: { dutyRatio: 0, walBudgetShare } })
      ).toBe('complete')
      const bounds = await sql<{ at: Date; wal: number }[]>`
        SELECT at, pg_wal_lsn_diff(lsn, '0/0')::float8 AS wal FROM delete_bound ORDER BY at`
      /** Pairs of start and end, one per page; the last page's bounds have no successor. */
      const pages = []
      for (let index = 0; index + 1 < bounds.length; index += 2) {
        pages.push({
          startedAt: bounds[index].at.getTime(),
          wal: bounds[index + 1].wal - bounds[index].wal,
        })
      }
      expect(pages.length).toBeGreaterThan(2)
      /**
       * Every page but the last was followed by its pause, so the WAL those pages wrote, over the
       * time from the first page's start to the last page's start, is the paced rate.
       */
      const paced = pages.slice(0, -1)
      const wal = paced.reduce((total, page) => total + page.wal, 0)
      const elapsedMs = pages[pages.length - 1].startedAt - pages[0].startedAt
      expect(wal).toBeGreaterThan(0)
      expect(wal / elapsedMs).toBeLessThanOrEqual(budgetBytesPerMs * 1.05)
    } finally {
      await sql`DROP TRIGGER IF EXISTS record_delete_start ON embedding`
      await sql`DROP TRIGGER IF EXISTS record_delete_end ON embedding`
      await sql`DROP FUNCTION record_delete_bound()`
      await sql`DROP TABLE delete_bound`
    }
  }, 60_000)

  it('runs maintenance only in background slices, one checkpointed operation past the budget at most', async () => {
    expect(await pass()).toBe(true)
    await sql`CREATE INDEX aa_retirement_hnsw_idx ON embedding_search USING hnsw (vector public.vector_l2_ops)`
    await sql`CREATE INDEX bb_retirement_hnsw_idx ON embedding_search USING hnsw (vector public.vector_l2_ops)`
    const oids = async () =>
      (
        await sql`SELECT to_regclass('aa_retirement_hnsw_idx')::oid AS aa,
          to_regclass('bb_retirement_hnsw_idx')::oid AS bb`
      )[0]
    const checkpoints = async () =>
      (
        await sql`SELECT reindexed_through, vacuumed_tables FROM search_embedding_cleanup_progress`
      )[0]
    const journaled = async () =>
      (
        await sql`SELECT name FROM script_migrations WHERE name = '0029_retire_all_search_embeddings'`
      ).length === 1
    const original = await oids()
    const blocker = postgres(readTestDatabaseUrl(), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let signalLocked!: () => void
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve
    })
    let holding: Promise<unknown> | undefined
    try {
      await runScriptMigrations(sql, [
        searchRetirementSlice({ budgetMs: 60_000, maintenance: false }),
      ])
      expect(await oids()).toEqual(original)
      expect(await checkpoints()).toEqual({ reindexed_through: '', vacuumed_tables: 0 })
      expect(await journaled()).toBe(false)

      /** An open writer makes the first concurrent rebuild outlast the slice's budget. */
      holding = blocker.begin(async (tx) => {
        await tx`UPDATE embedding_search SET vector = '[3,2,1]' WHERE id = '00001'`
        signalLocked()
        await released
      })
      await locked
      const slice = runScriptMigrations(sql, [
        searchRetirementSlice({ budgetMs: 300, maintenance: true, throttle: UNTHROTTLED }),
      ])
      await sleep(1_000)
      release()
      await holding
      await slice
      const afterSlice = await oids()
      expect(afterSlice.aa).not.toBe(original.aa)
      expect(afterSlice.bb).toBe(original.bb)
      expect(await checkpoints()).toEqual({
        reindexed_through: 'aa_retirement_hnsw_idx',
        vacuumed_tables: 0,
      })
      expect(await journaled()).toBe(false)

      await runScriptMigrations(sql, [backgroundRun])
      const finished = await oids()
      expect(finished.aa).toBe(afterSlice.aa)
      expect(finished.bb).not.toBe(original.bb)
      expect(await checkpoints()).toEqual({
        reindexed_through: 'bb_retirement_hnsw_idx',
        vacuumed_tables: 6,
      })
      expect(await journaled()).toBe(true)
    } finally {
      release()
      await holding
      await blocker.end()
      await sql`DROP INDEX IF EXISTS aa_retirement_hnsw_idx`
      await sql`DROP INDEX IF EXISTS bb_retirement_hnsw_idx`
    }
  }, 60_000)
})
