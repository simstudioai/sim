import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SYNC_EMBEDDING_SEARCH_FUNCTION } from '@sim/db/knowledge-projection'
import {
  inspectSearchProjection,
  purgeSearchProjection,
  SearchProjectionPurgeError,
} from '@sim/db/scripts/purge-search-projection'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Real PostgreSQL proof, on a private database provisioned through the same command as the shared
 * fixture (migrate or push): migration 0448 installs the provisioning paths' function, chunk
 * writes in Search knowledge bases project nothing and delete stale rows, ordinary bases project
 * every width as before with their source ACL, and the purge deletes only Search candidate rows,
 * reruns as a no-op and stops when a base stops being Search-marked.
 */
describe('Search candidate retirement in PostgreSQL', () => {
  const databaseUrl = readTestDatabaseUrl()
  const database = `sim_test_search_purge_${generateId().replaceAll('-', '')}`
  const fixtureUrl = new URL(databaseUrl)
  fixtureUrl.pathname = `/${database}`
  let sql: Sql
  /** The function and triggers the provisioning command installed, before migration 0448 replays. */
  let provisioned: Definitions

  interface Definitions {
    body: string
    sync: string
    acl: string
  }

  async function definitions(): Promise<Definitions[]> {
    return sql<Definitions[]>`
      SELECT p.prosrc AS body,
        (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
          WHERE t.tgname = 'embedding_search_sync' AND t.tgrelid = 'embedding'::regclass) AS sync,
        (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
          WHERE t.tgname = 'embedding_search_source_acl_set' AND t.tgrelid = 'embedding_search'::regclass) AS acl
      FROM pg_proc p WHERE p.oid = 'public.sync_embedding_search'::regproc`
  }

  async function control<T>(run: (admin: Sql) => Promise<T>): Promise<T> {
    const url = new URL(databaseUrl)
    url.pathname = '/postgres'
    const admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    try {
      return await run(admin)
    } finally {
      await admin.end()
    }
  }

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
    await control((admin) => admin.unsafe(`CREATE DATABASE "${database}" TEMPLATE template0`))
    sql = postgres(fixtureUrl.toString(), { max: 1, prepare: false, onnotice: () => undefined })
    for (const extension of ['vector', 'btree_gin', 'pg_trgm']) {
      await sql`CREATE EXTENSION IF NOT EXISTS ${sql(extension)}`
    }
    const provision = spawnSync(
      'bun',
      ['--no-env-file', `./scripts/${migrated ? 'migrate' : 'push'}.ts`],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          DATABASE_URL: fixtureUrl.toString(),
          MIGRATION_DATABASE_URL: fixtureUrl.toString(),
        },
        encoding: 'utf8',
        timeout: 90_000,
        maxBuffer: 8 * 1_024 * 1_024,
      }
    )
    expect(provision.status, provision.stdout + provision.stderr).toBe(0)
    ;[provisioned] = await definitions()
    // Every behaviour below runs on the function the versioned migration installs, replayed twice.
    const migration = await readFile(
      new URL('../migrations/0448_retire_search_projection_writes.sql', import.meta.url),
      'utf8'
    )
    for (let replay = 0; replay < 2; replay++) {
      await sql.begin(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await tx.unsafe(statement)
        }
      })
    }
    await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('reader', 'Synthetic reader', 'reader@example.test', true, now(), now())`
    await sql`INSERT INTO project (id, name, owner_id) VALUES ('project', 'Synthetic project', 'reader')`
    await sql`INSERT INTO workspace (id, project_id, name, owner_id, billed_account_user_id)
      VALUES ('workspace', 'project', 'Synthetic workspace', 'reader', 'reader'),
        ('workspace-b', 'project', 'Second synthetic workspace', 'reader', 'reader')`
  }, 120_000)

  afterAll(async () => {
    await sql?.end()
    await control((admin) => admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`))
  })

  beforeEach(async () => {
    await sql`DELETE FROM knowledge_base`
  })

  interface BaseFixture {
    id: string
    width: 384 | 768 | 1024 | 1536 | 3072
    model: string
    chunks: number
    /** A workspace holds at most one Search knowledge base. */
    workspaceId?: string
  }

  /** Seeds a base while ordinary so its chunks are projected, then applies the Search marker. */
  async function seedBase(base: BaseFixture, searchIndex = false) {
    await sql`INSERT INTO knowledge_base (id, user_id, workspace_id, name, embedding_model, embedding_dimension)
      VALUES (${base.id}, 'reader', ${base.workspaceId ?? 'workspace'}, ${base.id}, ${base.model}, ${base.width})`
    await sql`INSERT INTO document (id, knowledge_base_id, filename, file_url, file_size, mime_type, acl)
      VALUES (${`${base.id}-doc`}, ${base.id}, 'fixture.txt', 'fixture', 10, 'text/plain', ARRAY['u:reader@example.test'])`
    const column = base.width === 1536 ? 'embedding' : `embedding_${base.width}`
    await sql.unsafe(
      `INSERT INTO embedding
        (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, ${column})
      SELECT $1 || '-' || n, $1, $1 || '-doc', n, 'hash-' || n, 'Synthetic content', 17, 4, 0, 17,
        array_fill((n % 7 + 1) / 100.0::real, ARRAY[${base.width}])::vector(${base.width})
      FROM generate_series(1, $2::int) n`,
      [base.id, base.chunks]
    )
    if (searchIndex)
      await sql`UPDATE knowledge_base SET is_search_index = true WHERE id = ${base.id}`
  }

  async function candidateCount(knowledgeBaseId: string): Promise<number> {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM embedding_search WHERE knowledge_base_id = ${knowledgeBaseId}`
    return row.n
  }

  async function chunkCount(knowledgeBaseId: string): Promise<number> {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM embedding WHERE knowledge_base_id = ${knowledgeBaseId}`
    return row.n
  }

  const normalized = (text: string) => text.replace(/\s+/g, ' ').trim()

  it('installs the provisioning function and leaves both triggers as they were', async () => {
    const [migrated] = await definitions()
    expect(normalized(migrated.body)).toBe(normalized(provisioned.body))
    expect(normalized(migrated.body)).toBe(
      normalized(SYNC_EMBEDDING_SEARCH_FUNCTION.split('$$')[1])
    )
    expect(migrated.sync).toBe(provisioned.sync)
    expect(migrated.sync).toContain("current_setting('sim.projection_mode'")
    expect(migrated.acl).toBe(provisioned.acl)
    expect(migrated.acl).toContain('set_projection_source_acl')
  })

  it('projects nothing for Search chunk writes and deletes a stale candidate row', async () => {
    await seedBase({ id: 'search', width: 1536, model: 'text-embedding-3-small', chunks: 2 }, true)
    expect(await candidateCount('search')).toBe(2)
    await sql`INSERT INTO embedding
        (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, embedding)
      VALUES ('search-new', 'search', 'search-doc', 9, 'hash-new', 'Synthetic content', 17, 4, 0, 17,
        array_fill(0.03::real, ARRAY[1536])::vector(1536))`
    expect(await sql`SELECT id FROM embedding_search WHERE id = 'search-new'`).toEqual([])
    await sql`UPDATE embedding SET enabled = false WHERE id = 'search-1'`
    await sql`UPDATE embedding SET embedding = array_fill(0.05::real, ARRAY[1536])::vector(1536)
      WHERE id = 'search-2'`
    expect(await candidateCount('search')).toBe(0)
    expect(await chunkCount('search')).toBe(3)
  })

  it('projects ordinary chunks of every width with the prefix rule and the document ACL', async () => {
    await seedBase({ id: 'prefix', width: 1536, model: 'text-embedding-3-small', chunks: 2 })
    for (const width of [384, 768, 1024, 1536, 3072] as const) {
      await seedBase({ id: `full-${width}`, width, model: 'full-width-fixture', chunks: 1 })
    }
    await sql`UPDATE embedding SET enabled = false WHERE id = 'prefix-2'`
    const mismatched = await sql<{ id: string }[]>`
      SELECT e.id FROM embedding e
      JOIN knowledge_base k ON k.id = e.knowledge_base_id
      JOIN document d ON d.id = e.document_id
      LEFT JOIN embedding_search s ON s.id = e.id
      CROSS JOIN LATERAL (SELECT k.embedding_model = 'text-embedding-3-small' AS shortened) m
      WHERE s.id IS NULL
        OR (s.knowledge_base_id, s.document_id, s.enabled) IS DISTINCT FROM (e.knowledge_base_id, e.document_id, e.enabled)
        OR s.acl IS DISTINCT FROM d.acl
        OR (s."binary", s.binary_384, s.binary_768, s.binary_1024, s.binary_3072) IS DISTINCT FROM (
          binary_quantize(e.embedding)::bit(1536), binary_quantize(e.embedding_384)::bit(384),
          binary_quantize(e.embedding_768)::bit(768), binary_quantize(e.embedding_1024)::bit(1024),
          binary_quantize(e.embedding_3072)::bit(3072))
        OR s.vector_512 IS DISTINCT FROM CASE WHEN m.shortened
          THEN subvector(e.embedding, 1, 512)::halfvec(512) END
        OR (s.vector, s.vector_384, s.vector_768, s.vector_1024, s.vector_3072) IS DISTINCT FROM (
          CASE WHEN NOT m.shortened THEN e.embedding::halfvec(1536) END,
          e.embedding_384::halfvec(384), e.embedding_768::halfvec(768),
          e.embedding_1024::halfvec(1024), e.embedding_3072::halfvec(3072))`
    expect(mismatched).toEqual([])
    expect(
      (await sql`SELECT count(*)::int AS n FROM embedding_search WHERE vector_512 IS NOT NULL`)[0].n
    ).toBe(2)
  })

  it('counts and purges only Search candidate rows, and a rerun deletes nothing', async () => {
    await seedBase(
      { id: 'search-a', width: 1536, model: 'text-embedding-3-small', chunks: 5 },
      true
    )
    await seedBase(
      {
        id: 'search-b',
        width: 768,
        model: 'full-width-fixture',
        chunks: 3,
        workspaceId: 'workspace-b',
      },
      true
    )
    await seedBase({ id: 'ordinary', width: 1536, model: 'text-embedding-3-small', chunks: 4 })

    await sql`ANALYZE embedding_search`
    const before = await inspectSearchProjection(sql)
    expect(
      before.map(({ knowledgeBaseId, remaining }) => ({ knowledgeBaseId, remaining }))
    ).toEqual([
      { knowledgeBaseId: 'search-a', remaining: true },
      { knowledgeBaseId: 'search-b', remaining: true },
    ])
    expect(before.every((state) => state.estimatedRows > 0)).toBe(true)

    const batches: number[] = []
    expect(
      await purgeSearchProjection(sql, {
        batchSize: 2,
        pauseMs: 0,
        onBatch: (batch) => {
          batches.push(batch.deleted)
        },
      })
    ).toEqual({ deleted: 8, batches: 5, remaining: false })
    expect(batches.every((deleted) => deleted <= 2)).toBe(true)
    expect(await candidateCount('search-a')).toBe(0)
    expect(await candidateCount('search-b')).toBe(0)
    expect(await candidateCount('ordinary')).toBe(4)
    expect(await chunkCount('search-a')).toBe(5)
    expect(await chunkCount('search-b')).toBe(3)
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM document WHERE knowledge_base_id LIKE 'search-%'`
      )[0].n
    ).toBe(2)

    expect(await purgeSearchProjection(sql, { batchSize: 2, pauseMs: 0 })).toEqual({
      deleted: 0,
      batches: 0,
      remaining: false,
    })
    expect((await inspectSearchProjection(sql)).map((state) => state.remaining)).toEqual([
      false,
      false,
    ])
  })

  it('stops at the batch limit and resumes on the next run', async () => {
    await seedBase({ id: 'search', width: 1536, model: 'text-embedding-3-small', chunks: 5 }, true)
    expect(await purgeSearchProjection(sql, { batchSize: 2, pauseMs: 0, maxBatches: 1 })).toEqual({
      deleted: 2,
      batches: 1,
      remaining: true,
    })
    expect(await candidateCount('search')).toBe(3)
    expect(await purgeSearchProjection(sql, { batchSize: 2, pauseMs: 0 })).toMatchObject({
      deleted: 3,
      remaining: false,
    })
  })

  it('stops without deleting when a base is no longer Search-marked mid-run', async () => {
    await seedBase({ id: 'search', width: 1536, model: 'text-embedding-3-small', chunks: 5 }, true)
    await expect(
      purgeSearchProjection(sql, {
        batchSize: 2,
        pauseMs: 0,
        onBatch: async () => {
          await sql`UPDATE knowledge_base SET is_search_index = false WHERE id = 'search'`
        },
      })
    ).rejects.toBeInstanceOf(SearchProjectionPurgeError)
    expect(await candidateCount('search')).toBe(3)
  })

  it('stops when its connection is replaced, since the new session lacks the purge lock', async () => {
    await seedBase({ id: 'search', width: 1536, model: 'text-embedding-3-small', chunks: 5 }, true)
    let closed: () => void = () => undefined
    const purger = postgres(fixtureUrl.toString(), {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
      onclose: () => closed(),
    })
    const [{ pid }] = await purger<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    try {
      await expect(
        purgeSearchProjection(purger, {
          batchSize: 2,
          pauseMs: 0,
          onBatch: async () => {
            // Wait until the client has seen the close, as it has after a real pause.
            const seen = new Promise<void>((resolve) => {
              closed = resolve
            })
            await sql`SELECT pg_terminate_backend(${pid})`
            await seen
          },
        })
      ).rejects.toBeInstanceOf(SearchProjectionPurgeError)
    } finally {
      await purger.end()
    }
    expect(await candidateCount('search')).toBe(3)
    expect(await purgeSearchProjection(sql, { batchSize: 2, pauseMs: 0 })).toMatchObject({
      deleted: 3,
      remaining: false,
    })
  })

  it('runs as an operator command: dry run by default, deletes only with --execute', async () => {
    await seedBase({ id: 'search', width: 1536, model: 'text-embedding-3-small', chunks: 3 }, true)
    await seedBase({ id: 'ordinary', width: 1536, model: 'text-embedding-3-small', chunks: 2 })
    const run = (...args: string[]) => {
      return spawnSync('bun', ['--no-env-file', './scripts/purge-search-projection.ts', ...args], {
        cwd: packageRoot,
        env: { ...process.env, MIGRATION_DATABASE_URL: fixtureUrl.toString() },
        encoding: 'utf8',
        timeout: 30_000,
      })
    }
    const help = run('--help')
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('REINDEX INDEX CONCURRENTLY embedding_search_512_cosine_hnsw_idx')

    const dryRun = run()
    expect(dryRun.status, dryRun.stdout + dryRun.stderr).toBe(0)
    expect(await candidateCount('search')).toBe(3)

    const execute = run('--execute', '--batch-size', '2', '--pause-ms', '0')
    expect(execute.status, execute.stdout + execute.stderr).toBe(0)
    expect(await candidateCount('search')).toBe(0)
    expect(await candidateCount('ordinary')).toBe(2)

    expect(run('--execute', '--batch-size', '50000').status).toBe(1)
  })

  it('runs the operator command on the public tables whatever the database search_path', async () => {
    await seedBase({ id: 'search', width: 1536, model: 'text-embedding-3-small', chunks: 3 }, true)
    await sql`CREATE SCHEMA shadow`
    await sql`CREATE TABLE shadow.knowledge_base (id text, is_search_index boolean)`
    await sql.unsafe(`ALTER DATABASE "${database}" SET search_path = shadow, public`)
    try {
      const execute = spawnSync(
        'bun',
        ['--no-env-file', './scripts/purge-search-projection.ts', '--execute', '--pause-ms', '0'],
        {
          cwd: packageRoot,
          env: { ...process.env, MIGRATION_DATABASE_URL: fixtureUrl.toString() },
          encoding: 'utf8',
          timeout: 30_000,
        }
      )
      expect(execute.status, execute.stdout + execute.stderr).toBe(0)
    } finally {
      await sql.unsafe(`ALTER DATABASE "${database}" RESET search_path`)
      await sql`DROP SCHEMA shadow CASCADE`
    }
    expect(await candidateCount('search')).toBe(0)
  })
})
