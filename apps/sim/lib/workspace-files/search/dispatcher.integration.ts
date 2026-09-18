/** Real PostgreSQL cancellation must roll back preparation and release its advisory lock. */
import { withUtcTimestamps } from '@sim/db/timestamps'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
const mocks = vi.hoisted(() => ({ batchTrigger: vi.fn() }))
vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Dispatcher test database is not initialized')
    return database.current
  },
}))
vi.mock('@/lib/workspace-files/search/indexing', () => ({
  indexWorkspaceFileForSearch: vi.fn(),
  markWorkspaceFileSearchIndexFailed: vi.fn(),
}))
vi.mock('@/lib/workspace-files/search/index-state', () => ({
  cleanupFileSearchBuilds: vi.fn().mockResolvedValue(0),
}))
vi.mock('@trigger.dev/sdk', () => ({ tasks: { batchTrigger: mocks.batchTrigger } }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: true }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))

import { FILE_SEARCH_BACKFILL_PAGE_SIZE } from '@/lib/workspace-files/search/constants'
import {
  dispatchWorkspaceFileSearchIndexJobs,
  prepareWorkspaceFileSearchDispatch,
} from '@/lib/workspace-files/search/dispatcher'

describe('workspace file search dispatch PostgreSQL deadlines', () => {
  const schemaName = `dispatch_test_${generateId().replaceAll('-', '')}`
  const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('Dispatcher tests require a disposable local database')
  const target = new URL(databaseUrl)
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    (!target.pathname.startsWith('/sim_acl_test') && target.pathname !== '/sim_auth_scim')
  ) {
    throw new Error('File search tests require a disposable local integration database')
  }
  const connection = postgres(
    databaseUrl,
    withUtcTimestamps({
      max: 3,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName },
      onnotice: () => {},
    })
  )

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    await connection`CREATE TABLE workspace_file_search_backfill (
      id text PRIMARY KEY, after_workspace_id text, after_file_id text,
      completed_at timestamp, updated_at timestamp NOT NULL
    )`
    await connection`CREATE TABLE workspace_files (
      id text PRIMARY KEY, workspace_id text NOT NULL, context text NOT NULL,
      deleted_at timestamp, content_updated_at timestamp NOT NULL
    )`
    await connection`CREATE TABLE workspace_file_search_revision (
      file_id text PRIMARY KEY, workspace_id text NOT NULL,
      source_content_updated_at timestamp NOT NULL, status text NOT NULL DEFAULT 'pending',
      build_id text, failure_reason text, line_count integer NOT NULL DEFAULT 0,
      indexed_bytes integer NOT NULL DEFAULT 0, chunk_count integer NOT NULL DEFAULT 0,
      dispatched_at timestamp, updated_at timestamp NOT NULL DEFAULT now()
    )`
    await connection`CREATE TABLE workspace_file_search_dispatch_queue (
      workspace_id text PRIMARY KEY, enqueued_at timestamp NOT NULL,
      updated_at timestamp NOT NULL, last_dispatched_at timestamp
    )`
    await connection`CREATE INDEX workspace_files_workspace_active_keyset_idx
      ON workspace_files (workspace_id, id)
      WHERE deleted_at IS NULL AND context = 'workspace' AND workspace_id IS NOT NULL`
    await connection`CREATE INDEX ON workspace_file_search_revision
      (workspace_id, updated_at, file_id, source_content_updated_at)
      WHERE status = 'pending' AND dispatched_at IS NULL`
    await connection`CREATE INDEX ON workspace_file_search_revision (workspace_id, dispatched_at)
      WHERE status = 'pending' AND dispatched_at IS NOT NULL`
    await connection`INSERT INTO workspace_file_search_backfill (id, updated_at)
      VALUES ('workspace-file-search-chunks-v2', '2026-09-16 00:00:00')`
    await connection`CREATE TABLE workspace_file_search_build (id text PRIMARY KEY, expires_at timestamp)`
    await connection`CREATE TABLE workspace_file_search_chunk (build_id text NOT NULL, ordinal integer NOT NULL, PRIMARY KEY(build_id, ordinal))`
    database.current = drizzle(connection)
  })

  beforeEach(async () => {
    mocks.batchTrigger.mockReset()
    await connection`DROP TRIGGER IF EXISTS slow_backfill ON workspace_file_search_backfill`
    await connection`TRUNCATE workspace_files, workspace_file_search_revision, workspace_file_search_dispatch_queue`
    await connection`UPDATE workspace_file_search_backfill
      SET updated_at = '2026-09-16 00:00:00', completed_at = NULL,
        after_workspace_id = NULL, after_file_id = NULL`
  })

  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
      database.current = undefined
    }
  })

  async function expectAdvisoryLockReleased() {
    await connection.begin(async (tx) => {
      const [row] = await tx`SELECT pg_try_advisory_xact_lock(
        hashtextextended('workspace-file-search-dispatch', 0)
      ) AS acquired`
      expect(row.acquired).toBe(true)
    })
  }

  async function seedQueue(workspaceId: string, queued: number, active = 0) {
    await connection`UPDATE workspace_file_search_backfill SET completed_at = now()`
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      SELECT ${workspaceId} || '-' || lpad(n::text, 6, '0'), ${workspaceId}, 'workspace', '2026-09-16'
      FROM generate_series(1, ${queued + active}) n`
    await connection`INSERT INTO workspace_file_search_revision
      (file_id, workspace_id, source_content_updated_at, status, updated_at, dispatched_at)
      SELECT id, workspace_id, content_updated_at, 'pending', '2026-09-16',
        CASE WHEN row_number() OVER (ORDER BY id DESC) <= ${active} THEN now() ELSE NULL END
      FROM workspace_files WHERE workspace_id = ${workspaceId}`
    await connection`INSERT INTO workspace_file_search_dispatch_queue
      (workspace_id, enqueued_at, updated_at) VALUES (${workspaceId}, now(), now())`
  }

  it('skips a locked candidate without losing it or exceeding workspace capacity', async () => {
    await seedQueue('workspace-1', 3, 1)
    await connection.begin(async (tx) => {
      await tx`SELECT file_id FROM workspace_file_search_revision
        WHERE file_id = 'workspace-1-000001' FOR UPDATE`
      const results = await Promise.all([
        prepareWorkspaceFileSearchDispatch(),
        prepareWorkspaceFileSearchDispatch(),
      ])
      expect(results.flatMap((result) => result.payloads).map((payload) => payload.fileId)).toEqual(
        ['workspace-1-000002']
      )
      const [locked] = await tx`SELECT dispatched_at FROM workspace_file_search_revision
        WHERE file_id = 'workspace-1-000001'`
      expect(locked.dispatched_at).toBeNull()
    })
    expect((await prepareWorkspaceFileSearchDispatch()).payloads).toEqual([])
    await connection`UPDATE workspace_file_search_revision SET status = 'ready'
      WHERE file_id = 'workspace-1-000002'`
    const retry = await prepareWorkspaceFileSearchDispatch()
    expect(retry.payloads.map((payload) => payload.fileId)).toEqual(['workspace-1-000001'])
  })

  it('claims only available slots from a large backlog and preserves current-file eligibility', async () => {
    await seedQueue('workspace-1', 10_000, 1)
    await seedQueue('workspace-2', 3)
    await connection`UPDATE workspace_files SET deleted_at = now() WHERE id = 'workspace-1-000001'`
    await connection`UPDATE workspace_files SET content_updated_at = '2026-09-17'
      WHERE id = 'workspace-1-000002'`
    await connection`UPDATE workspace_files SET context = 'execution' WHERE id = 'workspace-1-000003'`
    const result = await prepareWorkspaceFileSearchDispatch()
    expect(result.payloads.map((payload) => payload.fileId).sort()).toEqual([
      'workspace-1-000004',
      'workspace-2-000001',
      'workspace-2-000002',
    ])
    expect((await prepareWorkspaceFileSearchDispatch()).payloads).toEqual([])
  })

  it('honors the remaining global capacity across workspace probes', async () => {
    await seedQueue('workspace-1', 3)
    await seedQueue('workspace-2', 3)
    await seedQueue('workspace-active', 0, 99)
    const result = await prepareWorkspaceFileSearchDispatch()
    expect(result.payloads).toHaveLength(1)
    expect((await prepareWorkspaceFileSearchDispatch()).payloads).toEqual([])
    const [row] =
      await connection`SELECT count(*)::int AS active FROM workspace_file_search_revision
      WHERE status = 'pending' AND dispatched_at IS NOT NULL`
    expect(row.active).toBe(100)
  })

  it('walks every live workspace file exactly once across backfill pages', async () => {
    const files = 2 * FILE_SEARCH_BACKFILL_PAGE_SIZE + FILE_SEARCH_BACKFILL_PAGE_SIZE / 2
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      SELECT md5(n::text), 'workspace-' || lpad((n % 7)::text, 2, '0'), 'workspace', '2026-09-16'
      FROM generate_series(1, ${files}) n`
    await connection`INSERT INTO workspace_files
      (id, workspace_id, context, deleted_at, content_updated_at)
      VALUES ('skipped-deleted', 'workspace-00', 'workspace', now(), '2026-09-16')`
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      VALUES ('skipped-context', 'workspace-00', 'execution', '2026-09-16')`

    let pages = 0
    for (;;) {
      await prepareWorkspaceFileSearchDispatch()
      pages += 1
      const [cursor] = await connection`SELECT completed_at FROM workspace_file_search_backfill`
      if (cursor.completed_at) break
      expect(pages).toBeLessThanOrEqual(files)
    }

    expect(pages).toBe(Math.ceil(files / FILE_SEARCH_BACKFILL_PAGE_SIZE))
    const [seeded] = await connection`SELECT count(*)::int AS total,
      count(DISTINCT file_id)::int AS distinct_files FROM workspace_file_search_revision`
    expect(seeded).toEqual({ total: files, distinct_files: files })
    const [skipped] = await connection`SELECT count(*)::int AS missed FROM workspace_files file
      WHERE file.context = 'workspace' AND file.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM workspace_file_search_revision revision
          WHERE revision.file_id = file.id)`
    expect(skipped.missed).toBe(0)
  }, 30_000)

  it('fails on a locked backfill row and releases the dispatcher lock', async () => {
    let release = () => {}
    let locked = () => {}
    const releaseLock = new Promise<void>((resolve) => {
      release = resolve
    })
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve
    })
    const blocker = connection.begin(async (tx) => {
      await tx`SELECT id FROM workspace_file_search_backfill FOR UPDATE`
      locked()
      await releaseLock
    })
    await lockReady
    try {
      const failure = await prepareWorkspaceFileSearchDispatch().catch((error: unknown) => error)
      expect(getPostgresErrorCode(failure)).toBe('55P03')
      await expectAdvisoryLockReleased()
    } finally {
      release()
      await blocker
    }
  })

  it('cancels a slow statement and rolls back its earlier writes', async () => {
    await connection`CREATE FUNCTION slow_backfill() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE workspace_file_search_backfill SET updated_at = '2099-01-01';
        PERFORM pg_sleep(15);
        RETURN NEW;
      END
    $$`
    await connection`CREATE TRIGGER slow_backfill BEFORE INSERT ON workspace_file_search_backfill
      FOR EACH ROW EXECUTE FUNCTION slow_backfill()`

    const failure = await prepareWorkspaceFileSearchDispatch().catch((error: unknown) => error)

    expect(getPostgresErrorCode(failure)).toBe('57014')
    const [row] =
      await connection`SELECT updated_at::text AS updated_at FROM workspace_file_search_backfill`
    expect(row.updated_at).toBe('2026-09-16 00:00:00')
    await expectAdvisoryLockReleased()
  }, 20_000)

  it('releases committed claims without the preparation deadlines', async () => {
    const fileId = generateId()
    const workspaceId = generateId()
    await connection`UPDATE workspace_file_search_backfill SET completed_at = now()`
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      VALUES (${fileId}, ${workspaceId}, 'workspace', '2026-09-16')`
    await connection`INSERT INTO workspace_file_search_revision
      (file_id, workspace_id, source_content_updated_at, status, updated_at)
      VALUES (${fileId}, ${workspaceId}, '2026-09-16', 'pending', now())`
    await connection`INSERT INTO workspace_file_search_dispatch_queue
      (workspace_id, enqueued_at, updated_at) VALUES (${workspaceId}, now(), now())`
    await connection`CREATE TABLE cleanup_timeouts (
      lock_timeout text, statement_timeout text, transaction_timeout text
    )`
    await connection`CREATE FUNCTION record_cleanup_timeouts() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO cleanup_timeouts VALUES (
          current_setting('lock_timeout'),
          current_setting('statement_timeout'),
          coalesce(current_setting('transaction_timeout', true), current_setting('idle_in_transaction_session_timeout'))
        );
        RETURN NEW;
      END
    $$`
    await connection`CREATE TRIGGER record_cleanup_timeouts AFTER UPDATE OF dispatched_at
      ON workspace_file_search_revision FOR EACH ROW
      WHEN (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NULL)
      EXECUTE FUNCTION record_cleanup_timeouts()`

    const enqueueError = new Error('Queue unavailable')
    mocks.batchTrigger.mockRejectedValueOnce(enqueueError)

    await expect(dispatchWorkspaceFileSearchIndexJobs()).rejects.toBe(enqueueError)
    expect(mocks.batchTrigger).toHaveBeenCalledWith('workspace-file-search-index', [
      expect.objectContaining({
        payload: {
          dispatchToken: expect.any(String),
          fileId,
          workspaceId,
          sourceContentUpdatedAt: '2026-09-16T00:00:00.000Z',
        },
      }),
    ])
    const [index] = await connection`SELECT dispatched_at FROM workspace_file_search_revision
      WHERE file_id = ${fileId}`
    expect(index.dispatched_at).toBeNull()
    const [queued] = await connection`SELECT workspace_id FROM workspace_file_search_dispatch_queue
      WHERE workspace_id = ${workspaceId}`
    expect(queued.workspace_id).toBe(workspaceId)
    const timeouts = await connection`SELECT * FROM cleanup_timeouts`
    expect([...timeouts]).toEqual([
      { lock_timeout: '0', statement_timeout: '0', transaction_timeout: '0' },
    ])
  })
})
