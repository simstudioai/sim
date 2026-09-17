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
vi.mock('@trigger.dev/sdk', () => ({ tasks: { batchTrigger: mocks.batchTrigger } }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: true }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))

import {
  dispatchWorkspaceFileSearchIndexJobs,
  prepareWorkspaceFileSearchDispatch,
} from '@/lib/workspace-files/search/dispatcher'

describe('workspace file search dispatch PostgreSQL deadlines', () => {
  const schemaName = `dispatch_test_${generateId().replaceAll('-', '')}`
  const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('Dispatcher tests require a disposable local database')
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
    await connection`CREATE TABLE workspace_file_search_index (
      file_id text NOT NULL, workspace_id text NOT NULL, source_content_updated_at timestamp NOT NULL,
      status text NOT NULL, dispatched_at timestamp, updated_at timestamp NOT NULL,
      PRIMARY KEY (file_id, source_content_updated_at)
    )`
    await connection`CREATE TABLE workspace_file_search_dispatch_queue (
      workspace_id text PRIMARY KEY, enqueued_at timestamp NOT NULL,
      updated_at timestamp NOT NULL, last_dispatched_at timestamp
    )`
    await connection`INSERT INTO workspace_file_search_backfill (id, updated_at)
      VALUES ('workspace-file-search-v1', '2026-09-16 00:00:00')`
    database.current = drizzle(connection)
  })

  beforeEach(async () => {
    mocks.batchTrigger.mockReset()
    await connection`DROP TRIGGER IF EXISTS slow_backfill ON workspace_file_search_backfill`
    await connection`TRUNCATE workspace_files, workspace_file_search_index, workspace_file_search_dispatch_queue`
    await connection`UPDATE workspace_file_search_backfill
      SET updated_at = '2026-09-16 00:00:00', completed_at = NULL`
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
    await connection`INSERT INTO workspace_file_search_index
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
          current_setting('transaction_timeout')
        );
        RETURN NEW;
      END
    $$`
    await connection`CREATE TRIGGER record_cleanup_timeouts AFTER UPDATE OF dispatched_at
      ON workspace_file_search_index FOR EACH ROW
      WHEN (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NULL)
      EXECUTE FUNCTION record_cleanup_timeouts()`

    const enqueueError = new Error('Queue unavailable')
    mocks.batchTrigger.mockRejectedValueOnce(enqueueError)

    await expect(dispatchWorkspaceFileSearchIndexJobs()).rejects.toBe(enqueueError)
    expect(mocks.batchTrigger).toHaveBeenCalledWith('workspace-file-search-index', [
      expect.objectContaining({
        payload: {
          fileId,
          workspaceId,
          sourceContentUpdatedAt: '2026-09-16T00:00:00.000Z',
        },
      }),
    ])
    const [index] = await connection`SELECT dispatched_at FROM workspace_file_search_index
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
