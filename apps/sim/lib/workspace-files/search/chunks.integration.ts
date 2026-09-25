import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DB_POOL_PROFILES } from '@sim/db/pool-profiles'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLiteralMatchStart } from '@/lib/workspace-files/search/sql-pattern'

const database = vi.hoisted(() => ({
  current: undefined as PostgresJsDatabase | undefined,
  search: undefined as PostgresJsDatabase | undefined,
}))
vi.mock('@sim/db', () => ({
  dbFor: (role: string) => {
    if (role !== 'search' || !database.search) throw new Error('Search database not initialized')
    return database.search
  },
  get db() {
    if (!database.current) throw new Error('Test database not initialized')
    return database.current
  },
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: vi.fn(),
  fetchWorkspaceFileBuffer: vi.fn(),
}))
vi.mock('@/lib/mothership/tools/server/files/doc-compile', () => ({ resolveServableDoc: vi.fn() }))
vi.mock('@/lib/file-parsers', () => ({ parseBuffer: vi.fn(), isSupportedFileType: vi.fn() }))

import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import {
  FILE_SEARCH_CLEANUP_BATCH_ROWS,
  FILE_SEARCH_CLEANUP_BUDGET_MS,
  FILE_SEARCH_CLEANUP_MAX_BATCHES,
  FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS,
  FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY,
  FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY,
} from '@/lib/workspace-files/search/constants'
import { prepareWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/dispatcher'
import { iterateFileSearchBatches } from '@/lib/workspace-files/search/index-batches'
import {
  iterateFileSearchChunks,
  planFileSearchIndex,
} from '@/lib/workspace-files/search/index-plan'
import {
  appendFileSearchChunks,
  beginFileSearchBuild,
  cleanupFileSearchBuilds,
  type FileSearchRevision,
  failFileSearchRevision,
  publishFileSearchBuild,
} from '@/lib/workspace-files/search/index-state'
import { compileFileSearchPattern } from '@/lib/workspace-files/search/pattern'
import { searchWorkspaceFileIndex } from '@/lib/workspace-files/search/repository'

const signal = new AbortController().signal
const revision: FileSearchRevision = {
  workspaceId: 'workspace-1',
  fileId: 'file-1',
  sourceContentUpdatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('chunked workspace file search on PostgreSQL', () => {
  const schema = `chunk_test_${generateId().replaceAll('-', '')}`
  const databaseUrl = readTestDatabaseUrl()
  const connection = postgres(
    databaseUrl,
    withUtcTimestamps({
      max: 4,
      prepare: false,
      fetch_types: false,
      connection: { search_path: `${schema},public` },
      onnotice: () => {},
    })
  )
  const searchConnection = postgres(
    databaseUrl,
    withUtcTimestamps({
      max: DB_POOL_PROFILES.search.primaryMax,
      prepare: false,
      fetch_types: false,
      connection: { search_path: `${schema},public` },
      onnotice: () => {},
    })
  )
  const ginWriteMigration = '0364_workspace_file_search_direct_gin.sql'

  async function applyMigration(migration: string) {
    const source = readFileSync(
      resolve(process.cwd(), '../../packages/db/migrations', migration),
      'utf8'
    ).replaceAll('"public".', `"${schema}".`)
    const session = await connection.reserve()
    try {
      await session`BEGIN`
      for (const statement of source.split('--> statement-breakpoint'))
        if (statement.trim()) await session.unsafe(statement)
      await session`COMMIT`
    } finally {
      await session`ROLLBACK`
      await session`RESET statement_timeout`
      session.release()
    }
  }

  async function ginState() {
    const [state] =
      await connection`SELECT c.oid, 'fastupdate=off' = ANY(c.reloptions) AS direct_writes,
      i.indisvalid, pending.pending_pages
      FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      CROSS JOIN LATERAL pgstatginindex(c.oid) pending
      WHERE c.oid = 'workspace_file_search_chunk_content_idx'::regclass`
    return state
  }

  async function addFile(
    fileId: string,
    workspaceId = 'workspace-1',
    name = fileId,
    folder: string | null = null
  ) {
    await connection`INSERT INTO workspace (id) VALUES (${workspaceId}) ON CONFLICT DO NOTHING`
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at, original_name, folder_id)
      VALUES (${fileId}, ${workspaceId}, 'workspace', ${revision.sourceContentUpdatedAt.toISOString()}::timestamp, ${name}, ${folder})`
    return { ...revision, fileId, workspaceId }
  }
  async function index(text: string, target = revision) {
    const build = await beginFileSearchBuild(target)
    expect(build).not.toBeNull()
    const plan = planFileSearchIndex({ text, partial: false }, signal)
    const chunks = [...iterateFileSearchChunks(plan, signal)]
    for (const batch of iterateFileSearchBatches(chunks, signal))
      expect(await appendFileSearchChunks(build!, batch, signal)).toBe(true)
    expect(
      await publishFileSearchBuild(
        build!,
        {
          status: 'ready',
          chunkCount: chunks.length,
          lineCount: plan.lineCount,
          indexedBytes: plan.indexedBytes,
        },
        signal
      )
    ).toBe(true)
    return build!
  }
  const search = (query: string, mode: 'exact' | 'regex' = 'exact', maxResults = 200) =>
    searchWorkspaceFileIndex({
      workspaceId: 'workspace-1',
      pattern: compileFileSearchPattern(query, mode),
      maxResults,
      signal,
    })

  const capturedQueries = new Map<string, { sql: string; params: unknown[] }>()
  let captureQuery = false

  beforeAll(async () => {
    await connection`CREATE EXTENSION IF NOT EXISTS pgstattuple`
    await connection`CREATE SCHEMA ${connection(schema)}`
    await connection`CREATE TABLE workspace (id text PRIMARY KEY)`
    await connection`CREATE TABLE workspace_files (id text PRIMARY KEY, workspace_id text REFERENCES workspace(id) ON DELETE CASCADE,
      context text NOT NULL, content_updated_at timestamp NOT NULL, deleted_at timestamp,
      original_name text NOT NULL, key text NOT NULL DEFAULT 'key', user_id text NOT NULL DEFAULT 'owner', folder_id text)`
    for (const migration of [
      '0313_puzzling_zodiak.sql',
      '0358_workspace_file_content_version_precision.sql',
      '0359_workspace_file_search_chunks.sql',
      ginWriteMigration,
      '0382_workspace_file_search_dispatch_handoff.sql',
    ]) {
      await applyMigration(migration)
    }
    database.current = drizzle(connection)
    database.search = drizzle(searchConnection, {
      logger: {
        logQuery(query, params) {
          if (
            captureQuery &&
            query.includes('from (select') &&
            query.includes('workspace_file_search_chunk')
          ) {
            const kind = query.includes('join lateral') ? 'ordered' : 'probe'
            if (!capturedQueries.has(kind)) capturedQueries.set(kind, { sql: query, params })
          }
        },
      },
    })
  })
  beforeEach(async () => {
    await connection`TRUNCATE workspace, workspace_files, workspace_file_search_revision, workspace_file_search_build,
      workspace_file_search_chunk, workspace_file_search_index, workspace_file_search_segment, workspace_file_search_dispatch_queue, workspace_file_search_backfill`
    await connection`INSERT INTO workspace_file_search_backfill (id, completed_at) VALUES ('workspace-file-search-chunks-v2', now())`
    await addFile('file-1')
  })
  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schema)} CASCADE`
    } finally {
      database.current = undefined
      database.search = undefined
      await Promise.all([connection.end(), searchConnection.end()])
    }
  })

  it('preserves search through disabling, draining, and replaying GIN pending-list maintenance', async () => {
    await connection`ALTER INDEX workspace_file_search_chunk_content_idx SET (fastupdate = on)`
    try {
      await index('heading\nold needle αβγ\ntail')
      const before = await ginState()
      expect(before.pending_pages).toBeGreaterThan(0)

      /** Simulate an interrupted rollout after the storage option commits but before the drain. */
      await connection`ALTER INDEX workspace_file_search_chunk_content_idx SET (fastupdate = off)`
      await index('heading\nnew needle αβγ\ntail', await addFile('file-2'))
      expect((await ginState()).pending_pages).toBe(before.pending_pages)
      const expected = [
        { fileId: 'file-1', lineNumber: 2 },
        { fileId: 'file-2', lineNumber: 2 },
      ]
      expect((await search('^(old|new) needle αβγ$', 'regex')).results).toMatchObject(expected)

      for (let attempt = 0; attempt < 2; attempt++) {
        await applyMigration(ginWriteMigration)
        expect(await ginState()).toMatchObject({
          oid: before.oid,
          indisvalid: true,
          direct_writes: true,
          pending_pages: 0,
        })
        expect((await search('needle αβγ')).results).toMatchObject(expected)
      }
      await index('heading\nnew needle αβγ\ntail', await addFile('file-3'))
      expect((await ginState()).pending_pages).toBe(0)
      expect((await search('^(old|new) needle αβγ$', 'regex')).results).toHaveLength(3)
    } finally {
      await applyMigration(ginWriteMigration)
    }
  })

  it('cancels a slow chunk statement without losing the connection or publishing partial content', async () => {
    const build = (await beginFileSearchBuild(revision))!
    const plan = planFileSearchIndex({ text: 'needle', partial: false }, signal)
    const chunks = [...iterateFileSearchChunks(plan, signal)]
    const writer = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connection: { search_path: `${schema},public` },
    })
    const original = database.current
    await connection`CREATE FUNCTION slow_chunk_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(11); RETURN NEW; END $$`
    await connection`CREATE TRIGGER slow_chunk_insert BEFORE INSERT ON workspace_file_search_chunk
      FOR EACH STATEMENT EXECUTE FUNCTION slow_chunk_insert()`
    try {
      database.current = drizzle(writer)
      const [before] = await writer`SELECT pg_backend_pid() AS pid`
      await expect(appendFileSearchChunks(build, chunks, signal)).rejects.toMatchObject({
        cause: { code: '57014' },
      })
      expect((await writer`SELECT pg_backend_pid() AS pid`)[0].pid).toBe(before.pid)
      expect(
        (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
      ).toBe(0)
      expect((await search('needle')).results).toEqual([])
    } finally {
      database.current = original
      await writer.end()
      await connection`DROP TRIGGER slow_chunk_insert ON workspace_file_search_chunk`
      await connection`DROP FUNCTION slow_chunk_insert()`
    }
    expect(await appendFileSearchChunks(build, chunks, signal)).toBe(true)
    expect(
      await publishFileSearchBuild(
        build,
        {
          status: 'ready',
          chunkCount: chunks.length,
          lineCount: plan.lineCount,
          indexedBytes: plan.indexedBytes,
        },
        signal
      )
    ).toBe(true)
    expect((await search('needle')).results).toMatchObject([{ fileId: 'file-1', lineNumber: 1 }])
  })

  it('bounds native GIN posting work and keeps dense-file exact and regex line results', async () => {
    const lines = Array.from(
      { length: 1200 },
      (_, i) => `dependency-${i}: sha512-${createHash('sha512').update(String(i)).digest('base64')}`
    )
    const text = lines.join('\n')
    const plan = planFileSearchIndex({ text, partial: false }, signal)
    const chunks = [...iterateFileSearchChunks(plan, signal)]
    const build = (await beginFileSearchBuild(revision))!
    await expect(appendFileSearchChunks(build, chunks.slice(0, 16), signal)).rejects.toThrow(
      'insert batch exceeds its budget'
    )
    for (const batch of iterateFileSearchBatches(chunks, signal)) {
      const [{ keys }] = await connection`SELECT sum(cardinality(show_trgm(content)))::int AS keys
        FROM (VALUES ${connection(batch.map((c) => [c.content]))}) AS chunk(content)`
      expect(keys).toBeLessThanOrEqual(FILE_SEARCH_INSERT_BATCH_TRIGRAM_KEYS)
      expect(await appendFileSearchChunks(build, batch, signal)).toBe(true)
    }
    expect((await search('dependency-1199')).results).toEqual([])
    expect(
      await publishFileSearchBuild(
        build,
        {
          status: 'ready',
          chunkCount: chunks.length,
          lineCount: plan.lineCount,
          indexedBytes: plan.indexedBytes,
        },
        signal
      )
    ).toBe(true)
    expect((await search(lines[1199])).results).toMatchObject([{ lineNumber: 1200 }])
    expect(
      (await search('^dependency-1199: sha512-[A-Za-z0-9+/]+=*$', 'regex')).results
    ).toMatchObject([{ lineNumber: 1200 }])
  })

  it('packs a million short lines without a million rows and bounds every stored value', async () => {
    await index('abc\n'.repeat(1_000_000))
    const [row] =
      await connection`SELECT count(*)::int AS count, max(octet_length(content)) AS largest FROM workspace_file_search_chunk`
    expect(row.count).toBeLessThan(500)
    expect(row.largest).toBeLessThanOrEqual(8192)
    const result = await search('abc', 'exact', 3)
    expect(result.results.map((r) => r.lineNumber)).toEqual([1, 2, 3])
    expect(result.truncated).toBe(true)
    expect(result.indexStatus).toMatchObject({ readyFiles: 1, partialFiles: 0 })
  })
  it('publishes an empty file with no chunk rows', async () => {
    await index('')
    const result = await search('needle')
    expect(result.results).toEqual([])
    expect(result.indexStatus).toMatchObject({ readyFiles: 1, pendingFiles: 0, partialFiles: 0 })
  })
  it('rejects publication when a chunk batch is missing', async () => {
    const build = (await beginFileSearchBuild(revision))!
    await expect(
      publishFileSearchBuild(
        build,
        { status: 'ready', chunkCount: 1, lineCount: 1, indexedBytes: 6 },
        signal
      )
    ).rejects.toThrow('incomplete')
    expect((await search('needle')).indexStatus.pendingFiles).toBe(1)
  })
  it('uses the database clock for build leases when the worker clock is ahead', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1000)
    try {
      await index('needle')
    } finally {
      clock.mockRestore()
    }
    expect((await search('needle')).results).toHaveLength(1)
  })
  it('excludes an incomplete file in full and reclaims its unpublished chunks', async () => {
    const build = (await beginFileSearchBuild(revision))!
    const plan = planFileSearchIndex({ text: 'needle', partial: false }, signal)
    await appendFileSearchChunks(build, [...iterateFileSearchChunks(plan, signal)], signal)
    await publishFileSearchBuild(
      build,
      { status: 'skipped', failureReason: 'incomplete_extraction' },
      signal
    )
    const result = await search('needle')
    expect(result.results).toEqual([])
    expect(result.indexStatus).toMatchObject({ skippedFiles: 1, readyFiles: 0, partialFiles: 0 })
    await cleanupFileSearchBuilds()
    expect(
      (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
    ).toBe(0)
  })
  it('does not allow an expired worker to publish after cleanup', async () => {
    const build = (await beginFileSearchBuild(revision))!
    await connection`UPDATE workspace_file_search_build SET expires_at = now() - interval '1 second' WHERE id = ${build.id}`
    await cleanupFileSearchBuilds()
    expect(
      await publishFileSearchBuild(
        build,
        { status: 'ready', chunkCount: 0, lineCount: 1, indexedBytes: 0 },
        signal
      )
    ).toBe(false)
    expect((await search('needle')).indexStatus.pendingFiles).toBe(1)
  })
  it('reindexes restored files and files moved back into workspace context', async () => {
    await index('needle')
    await connection`UPDATE workspace_files SET context = 'chat' WHERE id = 'file-1'`
    expect((await search('needle')).results).toEqual([])
    await connection`UPDATE workspace_files SET context = 'workspace' WHERE id = 'file-1'`
    expect((await search('needle')).indexStatus.pendingFiles).toBe(1)
    await index('needle')
    await connection`UPDATE workspace_files SET deleted_at = now() WHERE id = 'file-1'`
    await connection`UPDATE workspace_files SET deleted_at = NULL WHERE id = 'file-1'`
    expect((await search('needle')).indexStatus.pendingFiles).toBe(1)
    await index('needle')
    expect((await search('needle')).results).toHaveLength(1)
  })
  it('pages a broad query without losing or repeating logical lines', async () => {
    await index(`needle ${'x'.repeat(8184)}\n`.repeat(300))
    const result = await search('needle')
    expect(result.results.map((row) => row.lineNumber)).toEqual(
      Array.from({ length: 200 }, (_, i) => i + 1)
    )
    expect(result.truncated).toBe(true)
  })
  it('keeps unfinished builds hidden and fences an overlapping retry', async () => {
    const first = (await beginFileSearchBuild(revision))!
    const plan = planFileSearchIndex({ text: 'needle', partial: false }, signal)
    const chunks = [...iterateFileSearchChunks(plan, signal)]
    await appendFileSearchChunks(first, chunks, signal)
    expect((await search('needle')).results).toEqual([])
    const second = (await beginFileSearchBuild(revision))!
    expect(await appendFileSearchChunks(first, chunks, signal)).toBe(false)
    expect(
      await publishFileSearchBuild(
        first,
        { status: 'ready', chunkCount: 1, lineCount: 1, indexedBytes: 6 },
        signal
      )
    ).toBe(false)
    await appendFileSearchChunks(second, chunks, signal)
    expect(
      await publishFileSearchBuild(
        second,
        { status: 'ready', chunkCount: 1, lineCount: 1, indexedBytes: 6 },
        signal
      )
    ).toBe(true)
    await cleanupFileSearchBuilds()
    expect((await search('needle')).results).toHaveLength(1)
    const builds = await connection`SELECT id FROM workspace_file_search_build`
    expect(builds.map((b) => b.id)).toEqual([second.id])
  })
  it.each([
    ['^needle$', 'intro\nneedle\nlast', [2]],
    ['alpha.*omega', 'alpha\nomega', []],
    ['^alpha.*omega$', `intro\nalpha${'x'.repeat(25000)}omega\nlast`, [2]],
    ['needle', `${'x'.repeat(8190)}needle${'x'.repeat(9000)}`, [1]],
    ['^needle', `${'x'.repeat(8192)}needle`, []],
    ['^alpha.*omega$', `intro\r\nalpha${'🙂'.repeat(524288)}omega\r\nlast`, [2]],
    ['^needle$', '\r\n\r\nneedle\r\n\r\nneedle\r', [3, 5]],
    ['^needle$', `${'x'.repeat(8192)}\nneedle`, [2]],
    ['(alpha|omega)', `${'x'.repeat(8190)}omega${'x'.repeat(9000)}`, [1]],
    ['(?:ab){2,5}', `${'x'.repeat(8191)}abab`, [1]],
    ['\\bneedle\\b', 'x\nneedle\ny', [2]],
    ['ab(?:😀|😁)cde', `${'x'.repeat(8189)}ab😁cde${'x'.repeat(9000)}`, [1]],
    ['value=100%_ok', `${'x'.repeat(8190)}value=100%_ok`, [1]],
  ])('verifies complete logical lines for %s', async (query, text, expected) => {
    await index(text as string)
    const result = await search(query as string, 'regex')
    expect(result.results.map((row) => row.lineNumber)).toEqual(expected)
    expect(result.results.every((row) => Buffer.byteLength(row.text) <= 2048)).toBe(true)
  })
  it.each([
    [`${'İ'.repeat(9000)}needle`, 'needle', 9001],
    ['İneedle', 'i̇needle', 1],
    ['🙂İİneedle', 'needle', 4],
    ['İİneedle', 'missing', 0],
  ])(
    'locates literal previews in original characters under Unicode folding',
    async (text, query, start) => {
      const offset = buildLiteralMatchStart(sql`${text}::text COLLATE "und-x-icu"`, query, false)
      const [row] = await database.current!.execute(sql`SELECT ${offset} AS start`)
      expect(row.start).toBe(start)
    }
  )
  it('finds literals across Unicode fragment boundaries without duplicate lines', async () => {
    await index(`${'🙂'.repeat(2047)}🙂AbC${'x'.repeat(9000)}`)
    expect((await search('🙂AbC')).results.map((row) => row.lineNumber)).toEqual([1])
  })
  it('continues after a full page of fragment false positives', async () => {
    await index(`${(`alpha${'x'.repeat(17000)}\n`).repeat(130)}alpha omega`)
    expect((await search('alpha.*omega', 'regex')).results.map((r) => r.lineNumber)).toEqual([131])
  })
  it('rejects publication after a concurrent revision change', async () => {
    const build = (await beginFileSearchBuild(revision))!
    await connection`UPDATE workspace_files SET content_updated_at = content_updated_at + interval '1 second' WHERE id = 'file-1'`
    expect(
      await publishFileSearchBuild(
        build,
        { status: 'ready', chunkCount: 0, lineCount: 1, indexedBytes: 0 },
        signal
      )
    ).toBe(false)
    expect((await search('needle')).indexStatus.pendingFiles).toBe(1)
  })
  it.each(['soft', 'hard', 'workspace'])(
    'invalidates %s deletion before asynchronous cleanup',
    async (kind) => {
      await index('needle\n'.repeat(10000))
      if (kind === 'soft')
        await connection`UPDATE workspace_files SET deleted_at = now() WHERE id = 'file-1'`
      if (kind === 'hard') await connection`DELETE FROM workspace_files WHERE id = 'file-1'`
      if (kind === 'workspace') await connection`DELETE FROM workspace WHERE id = 'workspace-1'`
      expect((await search('needle')).results).toEqual([])
      expect(
        (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
      ).toBeGreaterThan(0)
      await cleanupFileSearchBuilds()
      expect(
        (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
      ).toBe(0)
    }
  )
  it('keeps cleanup to its batch/run budget and resumes', async () => {
    const build = (await beginFileSearchBuild(revision))!
    const count = FILE_SEARCH_CLEANUP_BATCH_ROWS * FILE_SEARCH_CLEANUP_MAX_BATCHES + 1
    await connection`INSERT INTO workspace_file_search_chunk (build_id, workspace_id, ordinal, line_start, fragment, content)
      SELECT ${build.id}, 'workspace-1', n, n + 1, false, 'x' FROM generate_series(0, ${count - 1}) n`
    await connection`UPDATE workspace_file_search_build SET expires_at = now() WHERE id = ${build.id}`
    await addFile('file-2')
    expect((await prepareWorkspaceFileSearchDispatch()).payloads).toEqual([])
    expect(await cleanupFileSearchBuilds()).toBeLessThanOrEqual(count - 1)
    expect(
      (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
    ).toBeGreaterThan(0)
    await cleanupFileSearchBuilds()
    expect((await prepareWorkspaceFileSearchDispatch()).payloads.map((row) => row.fileId)).toEqual([
      'file-2',
    ])
    expect(
      (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
    ).toBe(0)
  })
  it('ends a cleanup run cleanly when its time budget runs out', async () => {
    const build = (await beginFileSearchBuild(revision))!
    await connection`INSERT INTO workspace_file_search_chunk (build_id, workspace_id, ordinal, line_start, fragment, content)
      SELECT ${build.id}, 'workspace-1', n, n + 1, false, 'x' FROM generate_series(0, 999) n`
    await connection`UPDATE workspace_file_search_build SET expires_at = now() WHERE id = ${build.id}`

    /** The deadline is read first; every read after it reports a budget all but consumed. */
    const startedAt = Date.now()
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(startedAt)
      .mockReturnValue(startedAt + FILE_SEARCH_CLEANUP_BUDGET_MS - 1)
    try {
      await expect(cleanupFileSearchBuilds()).resolves.toBe(0)
    } finally {
      clock.mockRestore()
    }

    expect(
      (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
    ).toBe(1000)
  })
  it('abandons a batch whose budget was spent acquiring its connection', async () => {
    const build = (await beginFileSearchBuild(revision))!
    await connection`INSERT INTO workspace_file_search_chunk (build_id, workspace_id, ordinal, line_start, fragment, content)
      SELECT ${build.id}, 'workspace-1', n, n + 1, false, 'x' FROM generate_series(0, 999) n`
    await connection`UPDATE workspace_file_search_build SET expires_at = now() WHERE id = ${build.id}`

    /** Full budget when the batch is admitted, none left once its connection is in hand. */
    const startedAt = Date.now()
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(startedAt)
      .mockReturnValueOnce(startedAt)
      .mockReturnValue(startedAt + FILE_SEARCH_CLEANUP_BUDGET_MS - 1)
    try {
      await expect(cleanupFileSearchBuilds()).resolves.toBe(0)
    } finally {
      clock.mockRestore()
    }

    expect(
      (await connection`SELECT count(*)::int AS count FROM workspace_file_search_chunk`)[0].count
    ).toBe(1000)
  })
  it('retires many small builds within one cleanup run', async () => {
    await connection`INSERT INTO workspace_file_search_build (id, file_id, workspace_id, source_content_updated_at, expires_at)
      SELECT 'retired-' || n, 'file-1', 'workspace-1', now(), now() FROM generate_series(1, 100) n`
    await connection`INSERT INTO workspace_file_search_chunk (build_id, workspace_id, ordinal, line_start, fragment, content)
      SELECT 'retired-' || n, 'workspace-1', 0, 1, false, 'small' FROM generate_series(1, 100) n`
    expect(await cleanupFileSearchBuilds()).toBe(100)
    expect(
      (await connection`SELECT count(*)::int AS count FROM workspace_file_search_build`)[0].count
    ).toBe(0)
  })
  it('scopes results, coverage, and deterministic ordering to current workspace folders', async () => {
    const second = await addFile('file-2', 'workspace-1', 'A', 'folder-1')
    const other = await addFile('file-3', 'workspace-2', 'A', 'folder-1')
    await index('needle')
    await index('needle', second)
    await index('needle', other)
    const scoped = await searchWorkspaceFileIndex({
      workspaceId: 'workspace-1',
      pattern: compileFileSearchPattern('needle', 'exact'),
      maxResults: 200,
      folderScope: { folderIds: new Set(['folder-1']), includeRootItems: false },
      signal,
    })
    expect(scoped.results.map((row) => row.fileId)).toEqual(['file-2'])
    expect(scoped.indexStatus.readyFiles).toBe(1)
    expect((await search('needle')).results.map((row) => row.fileId)).toEqual(['file-2', 'file-1'])
  })
  it('backfills preexisting files idempotently and does not reset ready builds', async () => {
    await index('needle')
    await connection`DELETE FROM workspace_file_search_backfill`
    const first = await prepareWorkspaceFileSearchDispatch()
    const second = await prepareWorkspaceFileSearchDispatch()
    expect(first.backfilledFiles).toBe(1)
    expect(second.backfilledFiles).toBe(0)
    expect(first.payloads).toEqual([])
    expect(await beginFileSearchBuild(revision)).toBeNull()
    await cleanupFileSearchBuilds()
    expect((await search('needle')).indexStatus.readyFiles).toBe(1)
  })
  it('does not let an old dispatch callback fail a new claim', async () => {
    const older = new Date('2026-01-01T01:00:00Z')
    const newer = new Date('2026-01-01T02:00:00Z')
    await connection`UPDATE workspace_file_search_revision SET dispatched_at = ${newer.toISOString()}::timestamp`
    const active = (await beginFileSearchBuild(revision, newer.toISOString()))!
    expect(await beginFileSearchBuild(revision, older.toISOString())).toBeNull()
    expect(
      (
        await connection`SELECT expires_at > now() AS live FROM workspace_file_search_build WHERE id = ${active.id}`
      )[0].live
    ).toBe(true)
    await failFileSearchRevision(revision, older.toISOString())
    expect((await connection`SELECT status FROM workspace_file_search_revision`)[0].status).toBe(
      'pending'
    )
  })
  it('completes a claim handoff when its run begins, never for an older claim', async () => {
    const older = new Date('2026-01-01T01:00:00Z')
    const newer = new Date('2026-01-01T02:00:00Z')
    await connection`UPDATE workspace_file_search_revision
      SET dispatched_at = ${newer.toISOString()}::timestamp,
        handoff_expires_at = clock_timestamp() + interval '2 minutes'`
    const handoff = async () =>
      (await connection`SELECT handoff_expires_at FROM workspace_file_search_revision`)[0]
        .handoff_expires_at
    expect(await beginFileSearchBuild(revision, older.toISOString())).toBeNull()
    expect(await handoff()).not.toBeNull()
    expect(await beginFileSearchBuild(revision, newer.toISOString())).not.toBeNull()
    expect(await handoff()).toBeNull()
  })

  async function withOccupiedPool(client: postgres.Sql, count: number, run: () => Promise<void>) {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = 0
    const transactions: Promise<unknown>[] = []
    const ready = new Promise<void>((resolve, reject) => {
      for (let i = 0; i < count; i++) {
        transactions.push(
          client
            .begin(async () => {
              if (++started === count) resolve()
              await held
            })
            .catch(reject)
        )
      }
    })
    try {
      await ready
      await run()
    } finally {
      release()
      await Promise.all(transactions)
    }
  }

  it('searches while every shared application connection is occupied', async () => {
    await index('needle')
    await withOccupiedPool(connection, 4, async () => {
      expect((await search('needle')).results).toHaveLength(1)
    })
  })

  it('keeps application queries available while every search connection is occupied', async () => {
    await withOccupiedPool(searchConnection, DB_POOL_PROFILES.search.primaryMax, async () => {
      expect((await connection`SELECT 1 AS available`)[0].available).toBe(1)
    })
  })

  it('serves a twenty-search workspace burst through the bounded search pool', async () => {
    await index('needle')
    const results = await Promise.all(Array.from({ length: 20 }, () => search('needle')))
    expect(results).toHaveLength(20)
    for (const result of results) expect(result.results).toHaveLength(1)
  })

  it('admits a search up to the workspace and global ceilings', async () => {
    const held = await connection.reserve()
    try {
      await held`BEGIN`
      await held`SELECT pg_advisory_xact_lock(hashtextextended('workspace-file-search-read:workspace:workspace-1:' || n::text, 0)) FROM generate_series(1, ${FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY - 1}) n`
      await held`SELECT pg_advisory_xact_lock(hashtextextended('workspace-file-search-read:global:' || n::text, 0)) FROM generate_series(1, ${FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY - 1}) n`
      expect((await search('needle')).results).toEqual([])
    } finally {
      await held`ROLLBACK`
      held.release()
    }
  })

  it.each([
    ['workspace:workspace-1', FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY],
    ['global', FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY],
  ])('releases query admission slots after %s saturation', async (scope, capacity) => {
    const held = await connection.reserve()
    try {
      await held`BEGIN`
      await held`SELECT pg_advisory_xact_lock(hashtextextended('workspace-file-search-read:' || ${scope} || ':' || n::text, 0)) FROM generate_series(1, ${capacity}) n`
      await expect(search('needle')).rejects.toThrow('busy')
    } finally {
      await held`ROLLBACK`
      held.release()
    }
    expect((await search('needle')).results).toEqual([])
  })

  it.runIf(Boolean(process.env.FILE_SEARCH_BENCHMARK_OUTPUT))(
    'measures the actual scoped reader on a synthetic multi-file index',
    async () => {
      const fileCount = Number(process.env.FILE_SEARCH_BENCHMARK_FILES ?? 1000)
      if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > 10000)
        throw new Error('Invalid benchmark file count')
      const content = Array.from(
        { length: 90 },
        (_, n) => `common sample ${n} ${createHash('sha256').update(String(n)).digest('hex')}\n`
      ).join('')
      await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at, original_name)
      SELECT 'bench-file-' || n, 'workspace-1', 'workspace', ${revision.sourceContentUpdatedAt.toISOString()}::timestamp,
        'sample-' || lpad(n::text, 4, '0') FROM generate_series(1, ${fileCount}) n`
      await connection`INSERT INTO workspace_file_search_build (id, file_id, workspace_id, source_content_updated_at)
      SELECT 'bench-build-' || n, 'bench-file-' || n, 'workspace-1', ${revision.sourceContentUpdatedAt.toISOString()}::timestamp FROM generate_series(1, ${fileCount}) n`
      await connection`INSERT INTO workspace_file_search_chunk (build_id, workspace_id, ordinal, line_start, fragment, content)
      SELECT 'bench-build-' || file, 'workspace-1', chunk, chunk * 90 + 1, false,
        ${content} || CASE WHEN file = ${fileCount} AND chunk = 7 THEN 'unique-needle\n' ELSE '' END
      FROM generate_series(1, ${fileCount}) file CROSS JOIN generate_series(0, 7) chunk`
      await connection`UPDATE workspace_file_search_revision SET status = 'ready', build_id = replace(file_id, 'bench-file-', 'bench-build-'), chunk_count = 8
      WHERE file_id LIKE 'bench-file-%'`
      await connection`SELECT gin_clean_pending_list('workspace_file_search_chunk_content_idx')`
      await connection`ANALYZE workspace_file_search_chunk`
      await connection`ANALYZE workspace_file_search_revision`
      await connection`ANALYZE workspace_files`
      const results: Array<{ query: string; samplesMs: number[]; plan: unknown }> = []
      for (const [query, expected] of [
        ['common', 200],
        ['unique-needle', 1],
        ['missing-marker', 0],
      ] as const) {
        const samplesMs: number[] = []
        capturedQueries.clear()
        captureQuery = true
        for (let i = 0; i < 5; i++) {
          const start = performance.now()
          const result = await search(query)
          samplesMs.push(performance.now() - start)
          expect(result.results).toHaveLength(expected)
        }
        captureQuery = false
        const plan: Record<string, unknown> = {}
        for (const [kind, captured] of capturedQueries) {
          plan[kind] = await connection.unsafe(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.sql}`,
            captured.params as Parameters<typeof connection.unsafe>[1]
          )
        }
        results.push({ query, samplesMs, plan })
      }
      writeFileSync(process.env.FILE_SEARCH_BENCHMARK_OUTPUT!, JSON.stringify(results, null, 2))
    },
    300000
  )
})
