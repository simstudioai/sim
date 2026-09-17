/** Real PostgreSQL cancellation must roll back preparation and release its advisory lock. */
import { withUtcTimestamps } from '@sim/db/timestamps'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
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

import { prepareWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/dispatcher'

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
    await connection`INSERT INTO workspace_file_search_backfill (id, updated_at)
      VALUES ('workspace-file-search-v1', '2026-09-16 00:00:00')`
    database.current = drizzle(connection)
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
})
