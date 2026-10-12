import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runKnowledgeProjection } from '@sim/db/knowledge-projection'
import {
  abortSearchRetirement,
  advanceSearchRetirement,
  beginSearchRetirementPurge,
  cutoverSearchRetirement,
  finalizeSearchRetirement,
  getSearchRetirementStatus,
  initializeSearchRetirement,
} from '@sim/db/maintenance/search-retirement'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Real PostgreSQL proof: interrupted copy, late writes behind the cursor, deferred vectors,
 * width preservation, generation races, marker invalidation, NOWAIT cutover, cached writers,
 * destructive phase gates, and ordinary-KB isolation. The integration runner writes its JSON
 * artifact to INTEGRATION_REPORT_PATH (CI uploads test-results/integration.json by default).
 */
describe('operator-driven Search retirement in PostgreSQL', () => {
  const databaseUrl = readTestDatabaseUrl()
  let admin: Sql
  let sql: Sql
  let writer: Sql
  let database: string
  const template = `sim_test_retirement_template_${generateId().replaceAll('-', '')}`

  beforeAll(async () => {
    const source = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    let migrated: boolean
    try {
      const [row] = await source<{ migrated: boolean }[]>`
        SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS migrated`
      migrated = row.migrated
    } finally {
      await source.end()
    }
    const controlUrl = new URL(databaseUrl)
    controlUrl.pathname = '/postgres'
    const control = postgres(controlUrl.toString(), { max: 1, onnotice: () => undefined })
    try {
      await control.unsafe(`CREATE DATABASE "${template}" TEMPLATE template0`)
    } finally {
      await control.end()
    }
    const url = new URL(databaseUrl)
    url.pathname = `/${template}`
    const setup = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    try {
      for (const extension of ['vector', 'btree_gin', 'pg_trgm']) {
        await setup`CREATE EXTENSION IF NOT EXISTS ${setup(extension)}`
      }
    } finally {
      await setup.end()
    }
    // A private template avoids cloning the shared fixture while other suites hold connections.
    const provision = spawnSync(
      'bun',
      ['--no-env-file', `./scripts/${migrated ? 'migrate' : 'push'}.ts`],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          MIGRATION_DATABASE_URL: url.toString(),
        },
        encoding: 'utf8',
        timeout: 90_000,
        maxBuffer: 8 * 1_024 * 1_024,
      }
    )
    expect(provision.status, provision.stdout + provision.stderr).toBe(0)
  }, 120_000)

  afterAll(async () => {
    const url = new URL(databaseUrl)
    url.pathname = '/postgres'
    const control = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    try {
      await control.unsafe(`DROP DATABASE IF EXISTS "${template}"`)
    } finally {
      await control.end()
    }
  })

  beforeEach(async () => {
    database = `sim_test_retirement_${generateId().replaceAll('-', '')}`
    const controlUrl = new URL(databaseUrl)
    controlUrl.pathname = '/postgres'
    admin = postgres(controlUrl.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE DATABASE "${database}" TEMPLATE "${template.replaceAll('"', '""')}"`)
    const fixtureUrl = new URL(databaseUrl)
    fixtureUrl.pathname = `/${database}`
    const options = { max: 1, onnotice: () => undefined }
    sql = postgres(fixtureUrl.toString(), { ...options, prepare: false })
    writer = postgres(fixtureUrl.toString(), { ...options, prepare: true })
    await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('reader', 'Synthetic reader', 'reader@example.test', true, now(), now())`
    await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id)
      VALUES ('workspace', 'Synthetic workspace', 'reader', 'reader')`
    await sql`CREATE TABLE search_embedding_cleanup_progress (
      id integer PRIMARY KEY, knowledge_base_id text, phase text, after_id text)`
    await sql`INSERT INTO search_embedding_cleanup_progress VALUES (1, 'search', 'embeddings', '')`
    await sql`CREATE TABLE search_embedding_cleanup_targets (knowledge_base_id text PRIMARY KEY)`
    await sql`INSERT INTO search_embedding_cleanup_targets VALUES ('search')`
    const bases = [
      { id: 'prefix', width: 1536, model: 'text-embedding-3-small' },
      ...[384, 768, 1024, 1536, 3072].map((width) => ({
        id: `full-${width}`,
        width,
        model: 'full-width-fixture',
      })),
      { id: 'search', width: 1536, model: 'text-embedding-3-small' },
    ]
    for (const base of bases) {
      await sql`INSERT INTO knowledge_base (id, user_id, workspace_id, name, embedding_model, embedding_dimension, is_search_index)
        VALUES (${base.id}, 'reader', 'workspace', ${base.id}, ${base.model}, ${base.width}, ${base.id === 'search'})`
      await sql`INSERT INTO document (id, knowledge_base_id, filename, file_url, file_size, mime_type,
          processing_queue_token, acl)
        VALUES (${`${base.id}-doc`}, ${base.id}, 'fixture.txt', 'fixture', 10, 'text/plain', 'dispatch', ARRAY['u:reader@example.test'])`
      const column = base.width === 1536 ? 'embedding' : `embedding_${base.width}`
      await sql.unsafe(
        `INSERT INTO embedding
        (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, ${column})
        SELECT $1 || '-' || n, $1, $1 || '-doc', n, 'hash-' || n, 'Synthetic content', 17, 4, 0, 17,
          array_fill(0.01::real, ARRAY[${base.width}])::vector(${base.width})
        FROM generate_series(1, 4) n`,
        [base.id]
      )
    }
    // An older deferred writer can leave a canonical chunk without a projected vector.
    await sql`DELETE FROM embedding_search WHERE id = 'prefix-4'`
  }, 60_000)

  afterEach(async () => {
    await writer?.end()
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}"`)
      await admin.end()
    }
  })

  async function nextPage(pageSize = 5) {
    return advanceSearchRetirement(sql, { pageSize })
  }

  async function finishCopy() {
    for (let page = 0; page < 100; page++) {
      const state = await nextPage()
      if (state.phase === 'ready') return state
    }
    throw new Error('Fixture retirement did not reach the cutover gate')
  }

  it('resumes copy, includes late writes, replaces all widths, and only then purges Search chunks', async () => {
    expect(await getSearchRetirementStatus(sql)).toBeNull()
    await initializeSearchRetirement(sql)
    for (let page = 0; page < 10; page++) {
      if ((await nextPage()).copied > 0) break
    }
    expect((await getSearchRetirementStatus(sql))?.copied).toBeGreaterThan(0)
    expect(
      await sql`SELECT id FROM embedding_search_retirement_shadow WHERE id = 'full-1024-1'`
    ).toHaveLength(1)
    await writer`UPDATE embedding SET enabled = false WHERE id = 'full-1024-1'`
    await writer`DELETE FROM embedding WHERE id = 'full-1024-3'`
    await writer`INSERT INTO embedding (id, knowledge_base_id, document_id, chunk_index, chunk_hash,
        content, content_length, token_count, start_offset, end_offset, embedding)
      VALUES ('000-late', 'prefix', 'prefix-doc', 5, 'late', 'Late synthetic content', 22, 4, 0, 22,
        array_fill(0.02::real, ARRAY[1536])::vector(1536))`
    await initializeSearchRetirement(sql)
    await finishCopy()
    expect(
      (await sql`SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = 'search'`)[0].n
    ).toBe(4)
    await expect(beginSearchRetirementPurge(sql)).rejects.toThrow()
    // Warm a prepared reader and trigger writer before replacing the relation.
    const preparedRead = () =>
      writer`SELECT id, enabled FROM embedding_search WHERE id = 'prefix-1'`
    await preparedRead()
    await writer`UPDATE embedding SET enabled = false WHERE id = 'prefix-1'`
    await finishCopy()
    await cutoverSearchRetirement(sql)
    expect(await preparedRead()).toEqual([{ id: 'prefix-1', enabled: false }])
    await writer`UPDATE embedding SET enabled = true WHERE id = 'prefix-1'`
    expect(await preparedRead()).toEqual([{ id: 'prefix-1', enabled: true }])
    expect((await sql`SELECT count(*)::int AS n FROM embedding_search`)[0].n).toBe(24)
    expect(
      await sql`SELECT id FROM embedding_search WHERE knowledge_base_id = 'search'`
    ).toHaveLength(0)
    expect(await sql`SELECT id FROM embedding_search WHERE id = 'prefix-4'`).toHaveLength(1)
    expect(await sql`SELECT id FROM embedding_search WHERE id = 'full-1024-3'`).toHaveLength(0)
    expect(await sql`SELECT enabled FROM embedding_search WHERE id = 'full-1024-1'`).toEqual([
      { enabled: false },
    ])
    expect(
      (
        await sql`SELECT vector_dims(vector_512) AS width FROM embedding_search WHERE id = '000-late'`
      )[0].width
    ).toBe(512)
    for (const width of [384, 768, 1024, 1536, 3072]) {
      const column = width === 1536 ? 'vector' : `vector_${width}`
      expect(
        (
          await sql.unsafe(
            `SELECT vector_dims(${column}) AS width FROM embedding_search WHERE id = $1`,
            [`full-${width}-2`]
          )
        )[0].width
      ).toBe(width)
    }
    await expect(abortSearchRetirement(sql)).rejects.toThrow()
    await beginSearchRetirementPurge(sql)
    for (let page = 0; page < 100; page++) {
      const state = await nextPage()
      if (state.phase === 'finalize') break
    }
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('finalize')
    await finalizeSearchRetirement(sql)
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('done')
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(24)
    expect((await sql`SELECT count(*)::int AS n FROM knowledge_base`)[0].n).toBe(7)
    expect(
      (
        await sql`SELECT enabled, user_excluded, processing_queue_token FROM document WHERE id = 'search-doc'`
      )[0]
    ).toEqual({ enabled: false, user_excluded: true, processing_queue_token: null })
    expect(
      (
        await sql`SELECT enabled, user_excluded, processing_queue_token, acl FROM document WHERE id = 'prefix-doc'`
      )[0]
    ).toEqual({
      enabled: true,
      user_excluded: false,
      processing_queue_token: 'dispatch',
      acl: ['u:reader@example.test'],
    })
    await writer`DELETE FROM embedding WHERE id = '000-late'`
    expect(await sql`SELECT id FROM embedding_search WHERE id = '000-late'`).toHaveLength(0)
  })

  it('refuses cutover immediately while an ordinary reader holds the active projection', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    const [{ oid }] = await sql`SELECT 'embedding_search'::regclass::oid AS oid`
    await writer`BEGIN`
    try {
      await writer`SELECT id FROM embedding_search LIMIT 1`
      await expect(cutoverSearchRetirement(sql)).rejects.toMatchObject({ code: '55P03' })
      expect((await sql`SELECT 'embedding_search'::regclass::oid AS oid`)[0].oid).toBe(oid)
      expect((await getSearchRetirementStatus(sql))?.phase).toBe('ready')
    } finally {
      await writer`ROLLBACK`
    }
    await cutoverSearchRetirement(sql)
    expect((await sql`SELECT 'embedding_search'::regclass::oid AS oid`)[0].oid).not.toBe(oid)
  })

  it('refuses incomplete copy and invalidates the job when a KB changes classification', async () => {
    await initializeSearchRetirement(sql)
    await expect(cutoverSearchRetirement(sql)).rejects.toThrow()
    await writer`UPDATE knowledge_base SET is_search_index = false WHERE id = 'search'`
    await expect(nextPage()).rejects.toThrow()
    expect((await getSearchRetirementStatus(sql))?.invalidated).toBe(true)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(28)
    await abortSearchRetirement(sql)
    expect(await getSearchRetirementStatus(sql)).toBeNull()
    await writer`UPDATE embedding SET enabled = false WHERE id = 'prefix-1'`
    expect((await sql`SELECT enabled FROM embedding_search WHERE id = 'prefix-1'`)[0].enabled).toBe(
      false
    )
  })

  it('rolls back a failed page with its cursor and retries without losing or duplicating rows', async () => {
    await initializeSearchRetirement(sql)
    for (let n = 0; n < 20; n++) {
      if ((await getSearchRetirementStatus(sql))?.phase === 'copy') break
      await nextPage()
    }
    const before = await getSearchRetirementStatus(sql)
    await writer`BEGIN`
    try {
      await writer`LOCK TABLE embedding IN ACCESS EXCLUSIVE MODE`
      await expect(nextPage()).rejects.toMatchObject({ code: '55P03' })
    } finally {
      await writer`ROLLBACK`
    }
    expect(await getSearchRetirementStatus(sql)).toEqual(before)
    await finishCopy()
    await cutoverSearchRetirement(sql)
    expect((await sql`SELECT count(*)::int AS n FROM embedding_search`)[0].n).toBe(24)
  })

  it('refuses unknown inbound dependencies instead of silently redirecting only some readers', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await sql`CREATE VIEW external_projection_reader AS SELECT id FROM embedding_search`
    await expect(cutoverSearchRetirement(sql)).rejects.toThrow()
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('ready')
    await sql`DROP VIEW external_projection_reader`
    await cutoverSearchRetirement(sql)
  })

  it('fences the old cursor-based command while replacement work exists', async () => {
    await initializeSearchRetirement(sql)
    await expect(
      sql`UPDATE search_embedding_cleanup_progress SET after_id = 'late' WHERE id = 1`
    ).rejects.toThrow()
    expect(
      (await sql`SELECT after_id FROM search_embedding_cleanup_progress WHERE id = 1`)[0].after_id
    ).toBe('')
    await abortSearchRetirement(sql)
    await sql`UPDATE search_embedding_cleanup_progress SET after_id = 'late' WHERE id = 1`
  })

  it('refuses a repeatable-read snapshot taken before copy without any projection lock', async () => {
    await writer`BEGIN ISOLATION LEVEL REPEATABLE READ`
    try {
      await writer`SELECT id FROM workspace LIMIT 1`
      await initializeSearchRetirement(sql)
      await finishCopy()
      await expect(cutoverSearchRetirement(sql)).rejects.toThrow(/Transactions predate/)
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM embedding_search WHERE knowledge_base_id = 'search'`
        )[0].n
      ).toBe(4)
    } finally {
      await writer`ROLLBACK`
    }
    await cutoverSearchRetirement(sql)
    expect((await sql`SELECT count(*)::int AS n FROM embedding_search`)[0].n).toBe(24)
  })

  it('keeps deferred ordinary-vector repair working after cutover and metadata changes', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await cutoverSearchRetirement(sql)
    await writer.begin(async (tx) => {
      await tx`SET LOCAL sim.projection_mode = 'async'`
      await tx`UPDATE embedding SET enabled = false WHERE id = 'prefix-1'`
    })
    expect((await sql`SELECT enabled FROM embedding_search WHERE id = 'prefix-1'`)[0].enabled).toBe(
      true
    )
    await runKnowledgeProjection(writer, { budgetMs: 5_000, pageSize: 2 })
    expect((await sql`SELECT enabled FROM embedding_search WHERE id = 'prefix-1'`)[0].enabled).toBe(
      false
    )
    await writer`UPDATE knowledge_base SET embedding_model = 'updated-full-width-fixture' WHERE id = 'full-1536'`
    await beginSearchRetirementPurge(sql)
    for (let n = 0; n < 100; n++) {
      if ((await nextPage()).phase === 'finalize') break
    }
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('finalize')
    await finalizeSearchRetirement(sql)
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('done')
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(24)
  })

  it('retains a newer dirty generation written while its older image is being copied', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await writer`UPDATE embedding SET enabled = false WHERE id = 'prefix-1'`
    const barrierUrl = new URL(databaseUrl)
    barrierUrl.pathname = `/${database}`
    const barrier = postgres(barrierUrl.toString(), { max: 1, onnotice: () => undefined })
    await sql`CREATE FUNCTION retirement_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM set_config('lock_timeout', '1500ms', true);
        PERFORM pg_advisory_xact_lock(791184);
        RETURN NEW;
      END $$`
    await sql`CREATE TRIGGER retirement_test_barrier BEFORE INSERT OR UPDATE ON embedding_search_retirement_shadow
      FOR EACH ROW EXECUTE FUNCTION retirement_test_barrier()`
    await barrier`SELECT pg_advisory_lock(791184)`
    const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`
    const copy = Promise.allSettled([nextPage()])
    try {
      await vi.waitFor(
        async () => {
          const [{ waiting }] = await barrier`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = ${pid} AND locktype = 'advisory' AND NOT granted
        ) AS waiting`
          expect(waiting).toBe(true)
        },
        { interval: 5, timeout: 1_000 }
      )
      await writer`UPDATE embedding SET enabled = true WHERE id = 'prefix-1'`
      await barrier`SELECT pg_advisory_unlock(791184)`
      const [result] = await copy
      if (result.status === 'rejected') throw result.reason
      expect(
        await sql`SELECT embedding_id FROM search_retirement_changes WHERE embedding_id = 'prefix-1'`
      ).toHaveLength(1)
      expect(
        (await sql`SELECT enabled FROM embedding_search_retirement_shadow WHERE id = 'prefix-1'`)[0]
          .enabled
      ).toBe(false)
    } finally {
      await barrier`SELECT pg_advisory_unlock_all()`
      await copy
      await barrier.end()
      await sql`DROP TRIGGER retirement_test_barrier ON embedding_search_retirement_shadow`
      await sql`DROP FUNCTION retirement_test_barrier()`
    }
    await finishCopy()
    await cutoverSearchRetirement(sql)
    expect((await sql`SELECT enabled FROM embedding_search WHERE id = 'prefix-1'`)[0].enabled).toBe(
      true
    )
  })

  it('catches a late Search write behind the purge cursor before completing document retirement', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await cutoverSearchRetirement(sql)
    await beginSearchRetirementPurge(sql)
    for (let n = 0; n < 100; n++) {
      if ((await nextPage()).phase === 'documents') break
    }
    await writer`INSERT INTO embedding (id, knowledge_base_id, document_id, chunk_index, chunk_hash,
        content, content_length, token_count, start_offset, end_offset, embedding)
      VALUES ('000-late-search', 'search', 'search-doc', 5, 'late', 'Late synthetic content', 22, 4, 0, 22,
        array_fill(0.02::real, ARRAY[1536])::vector(1536))`
    for (let n = 0; n < 100; n++) {
      if ((await nextPage()).phase === 'finalize') break
    }
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('finalize')
    await finalizeSearchRetirement(sql)
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('done')
    expect(await sql`SELECT id FROM embedding WHERE knowledge_base_id = 'search'`).toHaveLength(0)
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(24)
    expect(
      await sql`SELECT tgname FROM pg_trigger WHERE tgrelid = 'embedding'::regclass
      AND tgname = 'search_retirement_capture'`
    ).toHaveLength(0)
  })

  it.each(['abort', 'begin-purge', 'finalize'] as const)(
    'rolls back %s if its implicit DROP lock conflicts with a reader',
    async (command) => {
      await initializeSearchRetirement(sql)
      if (command !== 'abort') {
        await finishCopy()
        await cutoverSearchRetirement(sql)
      }
      if (command === 'finalize') {
        await beginSearchRetirementPurge(sql)
        for (let n = 0; n < 100; n++) {
          if ((await nextPage()).phase === 'finalize') break
        }
      }
      const before = await getSearchRetirementStatus(sql)
      const operation =
        command === 'abort'
          ? abortSearchRetirement
          : command === 'begin-purge'
            ? beginSearchRetirementPurge
            : finalizeSearchRetirement
      await writer`BEGIN`
      try {
        await writer`SELECT id FROM embedding LIMIT 1`
        await expect(operation(sql)).rejects.toMatchObject({ code: '55P03' })
        expect(await getSearchRetirementStatus(sql)).toEqual(before)
        expect(await writer`SELECT id FROM embedding_search WHERE id = 'prefix-1'`).toHaveLength(1)
      } finally {
        await writer`ROLLBACK`
      }
      await operation(sql)
      expect((await getSearchRetirementStatus(sql))?.phase ?? null).toBe(
        command === 'abort' ? null : command === 'begin-purge' ? 'purge' : 'done'
      )
    }
  )

  it('returns from finalization to bounded purge when a late Search write arrives', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await cutoverSearchRetirement(sql)
    await beginSearchRetirementPurge(sql)
    for (let n = 0; n < 100; n++) {
      if ((await nextPage()).phase === 'finalize') break
    }
    expect((await nextPage()).phase).toBe('finalize')
    expect(
      await sql`SELECT tgname FROM pg_trigger WHERE tgrelid = 'embedding'::regclass
      AND tgname = 'search_retirement_capture'`
    ).toHaveLength(1)
    await writer`UPDATE document SET enabled = true, user_excluded = false WHERE id = 'search-doc'`
    await writer`INSERT INTO embedding (id, knowledge_base_id, document_id, chunk_index, chunk_hash,
        content, content_length, token_count, start_offset, end_offset, embedding)
      VALUES ('000-final-late-search', 'search', 'search-doc', 5, 'late', 'Late synthetic content', 22, 4, 0, 22,
        array_fill(0.02::real, ARRAY[1536])::vector(1536))`
    expect((await finalizeSearchRetirement(sql)).phase).toBe('purge')
    for (let n = 0; n < 100; n++) {
      if ((await nextPage()).phase === 'finalize') break
    }
    expect((await finalizeSearchRetirement(sql)).phase).toBe('done')
    expect(await sql`SELECT id FROM embedding WHERE knowledge_base_id = 'search'`).toHaveLength(0)
    expect(
      (await sql`SELECT enabled, user_excluded FROM document WHERE id = 'search-doc'`)[0]
    ).toEqual({ enabled: false, user_excluded: true })
  })

  it('refuses a stored SQL function that would retain the old projection identity', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await sql`CREATE FUNCTION retirement_dependent_function() RETURNS bigint
      LANGUAGE SQL RETURN (SELECT count(*) FROM embedding_search)`
    await expect(cutoverSearchRetirement(sql)).rejects.toThrow(/dependencies/)
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('ready')
    expect((await sql`SELECT retirement_dependent_function() AS n`)[0].n).toBe('27')
  })

  it('rejects a replacement index changed after preparation', async () => {
    await initializeSearchRetirement(sql)
    await finishCopy()
    await sql`DROP INDEX embedding_search_retirement_shadow_512_hnsw_idx`
    await sql`CREATE INDEX embedding_search_retirement_shadow_512_hnsw_idx
      ON embedding_search_retirement_shadow (enabled)`
    await expect(cutoverSearchRetirement(sql)).rejects.toThrow()
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('ready')
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM embedding_search WHERE knowledge_base_id = 'search'`
      )[0].n
    ).toBe(4)
  })

  it('refuses a disabled canonical writer before creating maintenance objects', async () => {
    await sql`ALTER TABLE embedding DISABLE TRIGGER embedding_search_sync`
    await expect(initializeSearchRetirement(sql)).rejects.toThrow()
    expect(await getSearchRetirementStatus(sql)).toBeNull()
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(28)
  })

  it('serializes with another maintenance operator without advancing its checkpoint', async () => {
    await initializeSearchRetirement(sql)
    const before = await getSearchRetirementStatus(sql)
    await writer`SELECT pg_advisory_lock(hashtextextended('sim:search-retirement-maintenance', 0))`
    try {
      await expect(nextPage()).rejects.toThrow(/Another migration or retirement operation/)
    } finally {
      await writer`SELECT pg_advisory_unlock_all()`
    }
    expect(await getSearchRetirementStatus(sql)).toEqual(before)
  })

  it('refuses db:push before schema reconciliation once replacement retirement exists', async () => {
    await initializeSearchRetirement(sql)
    const fixtureUrl = new URL(databaseUrl)
    fixtureUrl.pathname = `/${database}`
    const script = fileURLToPath(new URL('../scripts/push.ts', import.meta.url))
    const result = spawnSync('bun', ['--no-env-file', script, '--retirement-test-invalid-option'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: fixtureUrl.toString() },
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1_024,
    })
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Schema push is disabled after Search retirement starts'
    )
    expect(`${result.stdout}${result.stderr}`).not.toContain('Unrecognized options')
    expect((await getSearchRetirementStatus(sql))?.phase).toBe('snapshot')
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(28)
  })

  it('refuses db:push while retirement holds its maintenance fence before creating a receipt', async () => {
    await writer`SELECT pg_advisory_lock(hashtextextended('sim:search-retirement-maintenance', 0))`
    try {
      const fixtureUrl = new URL(databaseUrl)
      fixtureUrl.pathname = `/${database}`
      const result = spawnSync(
        'bun',
        ['--no-env-file', './scripts/push.ts', '--retirement-test-invalid-option'],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: fixtureUrl.toString() },
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 64 * 1_024,
        }
      )
      expect(result.status).toBe(1)
      expect(`${result.stdout}${result.stderr}`).toContain(
        'Another migration or retirement operation'
      )
      expect(`${result.stdout}${result.stderr}`).not.toContain('Unrecognized options')
      expect(await getSearchRetirementStatus(sql)).toBeNull()
    } finally {
      await writer`SELECT pg_advisory_unlock_all()`
    }
  })

  it('fences retirement during db:push and stops database preparation when its fence connection closes', async () => {
    await sql`ALTER TABLE workspace_files ADD COLUMN size bigint`
    await writer`BEGIN`
    await writer`LOCK TABLE workspace_files IN ACCESS EXCLUSIVE MODE`
    const fixtureUrl = new URL(databaseUrl)
    fixtureUrl.pathname = `/${database}`
    const child = spawn(
      'bun',
      ['--no-env-file', './scripts/push.ts', '--force', '--retirement-test-invalid-option'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: fixtureUrl.toString() },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      }
    )
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    try {
      await vi.waitFor(
        async () => {
          expect(
            await sql`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query = 'LOCK TABLE public.workspace_files IN ACCESS EXCLUSIVE MODE'`
          ).toHaveLength(1)
        },
        { timeout: 5_000 }
      )
      await expect(initializeSearchRetirement(sql)).rejects.toThrow(
        /Another migration or retirement operation/
      )
      const [guard] = await sql`SELECT pid, backend_xmin FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = 'sim-db-push'`
      expect(guard.backend_xmin).toBeNull()
      await sql`SELECT pg_terminate_backend(${guard.pid})`
      expect(await exited).toBe(1)
      expect(output).toContain('Schema-push lock connection closed')
      expect(output).not.toContain('Unrecognized options')
      await writer`ROLLBACK`
      await vi.waitFor(async () => {
        expect(
          await sql`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query = 'LOCK TABLE public.workspace_files IN ACCESS EXCLUSIVE MODE'`
        ).toHaveLength(0)
      })
      expect(
        await sql`SELECT attname FROM pg_attribute
        WHERE attrelid = 'workspace_files'::regclass AND attname = 'size' AND NOT attisdropped`
      ).toHaveLength(1)
      expect(await getSearchRetirementStatus(sql)).toBeNull()
    } finally {
      await writer`ROLLBACK`
      await exited
    }
  })

  it('the operator CLI refuses unverified endpoints and connection overrides before connecting', () => {
    const script = fileURLToPath(new URL('../scripts/retire-indexed-search.ts', import.meta.url))
    const overrideUrl = new URL(databaseUrl)
    overrideUrl.searchParams.set('statement_timeout', '0')
    for (const url of [
      'postgresql://reader@pool.example.invalid:5432/postgres',
      'postgresql://reader@fixture.pg.psdb.cloud:6432/postgres?sslmode=verify-full&sslrootcert=system',
      'postgresql://reader@fixture.pg.psdb.cloud.example.invalid:5432/postgres',
      'postgresql://reader@localhost:5432/production',
      'postgresql://reader@fixture.pg.psdb.cloud:5432/postgres?sslmode=disable',
      'postgresql://fixture.pg.psdb.cloud:5432/postgres?sslmode=verify-full&sslrootcert=system',
      'postgresql://reader@fixture.pg.psdb.cloud:5432/?sslmode=verify-full&sslrootcert=system',
      overrideUrl.toString(),
    ]) {
      const result = spawnSync('bun', ['--no-env-file', script, 'identity'], {
        env: { ...process.env, NODE_ENV: 'development', MIGRATION_DATABASE_URL: url },
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 64 * 1_024,
      })
      expect(result.status).toBe(1)
      expect(`${result.stdout}${result.stderr}`).not.toContain(url)
    }
  })

  it('the CLI respects health gates, keeps status read-only, and stops after losing its session', async () => {
    const fixtureUrl = new URL(databaseUrl)
    fixtureUrl.pathname = `/${database}`
    const script = fileURLToPath(new URL('../scripts/retire-indexed-search.ts', import.meta.url))
    const environment = {
      ...process.env,
      NODE_ENV: 'development',
      MIGRATION_DATABASE_URL: fixtureUrl.toString(),
    }
    const invoke = (...args: string[]) =>
      spawnSync('bun', ['--no-env-file', script, ...args], {
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 64 * 1_024,
      })
    expect(invoke('status').status).toBe(0)
    expect(await getSearchRetirementStatus(sql)).toBeNull()
    expect(invoke('prepare', '--ack-release-drained').status).toBe(1)
    expect(await getSearchRetirementStatus(sql)).toBeNull()
    const identity = invoke('identity')
    expect(identity.status).toBe(0)
    const databaseId = identity.stdout.trim()
    const directory = await mkdtemp(join(tmpdir(), 'retirement-cli-'))
    try {
      const policy = join(directory, 'policy.json')
      const health = join(directory, 'health.json')
      await writeFile(
        policy,
        JSON.stringify({
          databaseId,
          maxReplicaLagBytes: 1,
          maxReplicaLagSeconds: 1,
          maxWalBytesPerSecond: 1_000,
          maxDatabaseP95Ms: 100,
          maxCpuPercent: 50,
          minFreeStorageBytes: 100,
          maxSampleAgeMs: 30_000,
        })
      )
      const sample = {
        databaseId,
        observedAt: new Date().toISOString(),
        healthy: false,
        maintenanceAllowed: true,
        cutoverAllowed: false,
        replicaLagBytes: 0,
        replicaLagSeconds: 0,
        walBytesPerSecond: 0,
        databaseP95Ms: 1,
        cpuPercent: 1,
        freeStorageBytes: 1_000,
      }
      await writeFile(health, JSON.stringify(sample))
      const refused = invoke(
        'prepare',
        '--ack-release-drained',
        '--health-file',
        health,
        '--health-policy',
        policy
      )
      expect(refused.status).toBe(1)
      expect(`${refused.stdout}${refused.stderr}`).toContain('unhealthy')
      expect(await getSearchRetirementStatus(sql)).toBeNull()
      expect(invoke('status').status).toBe(0)
      await writeFile(health, JSON.stringify({ ...sample, healthy: true }))
      expect(
        invoke(
          'prepare',
          '--ack-release-drained',
          '--health-file',
          health,
          '--health-policy',
          policy
        ).status
      ).toBe(0)
      const runner = spawn(
        'bun',
        [
          '--no-env-file',
          script,
          'run',
          '--pages',
          '2',
          '--health-file',
          health,
          '--health-policy',
          policy,
        ],
        {
          env: environment,
          stdio: 'ignore',
          timeout: 20_000,
        }
      )
      const exited = new Promise<number | null>((resolve, reject) => {
        runner.once('error', reject)
        runner.once('close', resolve)
      })
      try {
        await vi.waitFor(
          async () => {
            expect(
              (await sql`SELECT after_id FROM search_retirement_state WHERE id = 1`)[0].after_id
            ).not.toBe('')
          },
          { timeout: 5_000 }
        )
        const before = await getSearchRetirementStatus(sql)
        const [session] = await sql`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = 'sim-search-data-retirement'`
        await sql`SELECT pg_terminate_backend(${session.pid})`
        const exitCode = await exited
        expect(await getSearchRetirementStatus(sql)).toEqual(before)
        expect(exitCode).toBe(1)
      } finally {
        runner.kill('SIGKILL')
        await exited
      }
      await abortSearchRetirement(sql)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    const oldScript = fileURLToPath(
      new URL('../script-migrations/0027_retire_search_embeddings.ts', import.meta.url)
    )
    expect(
      spawnSync('bun', ['--no-env-file', oldScript, '--maintenance'], {
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 64 * 1_024,
      }).status
    ).toBe(1)
    expect(await getSearchRetirementStatus(sql)).toBeNull()
    expect((await sql`SELECT count(*)::int AS n FROM embedding`)[0].n).toBe(28)
  })
})
