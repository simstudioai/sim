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

import {
  FILE_SEARCH_BACKFILL_PAGE_SIZE,
  FILE_SEARCH_DISPATCH_HANDOFF_MS,
  FILE_SEARCH_INDEX_STALE_DISPATCH_MS,
} from '@/lib/workspace-files/search/constants'
import {
  dispatchWorkspaceFileSearchIndexJobs,
  prepareWorkspaceFileSearchDispatch,
} from '@/lib/workspace-files/search/dispatcher'

describe('workspace file search dispatch PostgreSQL deadlines', () => {
  const schemaName = `dispatch_test_${generateId().replaceAll('-', '')}`
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('Dispatcher tests require a disposable local database')
  const target = new URL(databaseUrl)
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/(^|_)test(_|$)/.test(target.pathname.slice(1))
  ) {
    throw new Error('File search tests require a disposable local integration database')
  }
  /** Every statement the dispatcher issues, so a test can EXPLAIN the exact SQL it ran. */
  const statements: { query: string; params: readonly unknown[] }[] = []
  const connection = postgres(
    databaseUrl,
    withUtcTimestamps({
      max: 3,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName },
      onnotice: () => {},
      debug: (_connection: unknown, query: string, params: readonly unknown[]) => {
        statements.push({ query, params })
      },
    })
  )

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    await connection`CREATE TABLE workspace_file_search_backfill (
      id text PRIMARY KEY, after_workspace_id text, after_file_id text,
      completed_at timestamp, updated_at timestamp NOT NULL
    )`
    /**
     * `workspace_id` is nullable here because it is nullable in production. Declaring it NOT NULL
     * lets PostgreSQL discard the walk's `workspace_id IS NOT NULL` clause as trivially true, after
     * which it can no longer prove the partial keyset index covers the query and silently stops
     * using it.
     */
    await connection`CREATE TABLE workspace_files (
      id text PRIMARY KEY, workspace_id text, context text NOT NULL,
      deleted_at timestamp, content_updated_at timestamp NOT NULL
    )`
    await connection`CREATE TABLE workspace_file_search_revision (
      file_id text PRIMARY KEY, workspace_id text NOT NULL,
      source_content_updated_at timestamp NOT NULL, status text NOT NULL DEFAULT 'pending',
      build_id text, failure_reason text, line_count integer NOT NULL DEFAULT 0,
      indexed_bytes integer NOT NULL DEFAULT 0, chunk_count integer NOT NULL DEFAULT 0,
      dispatched_at timestamp, handoff_expires_at timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )`
    await connection`CREATE TABLE workspace_file_search_dispatch_queue (
      workspace_id text PRIMARY KEY, enqueued_at timestamp NOT NULL,
      updated_at timestamp NOT NULL, last_dispatched_at timestamp
    )`
    await connection`CREATE INDEX workspace_files_workspace_active_keyset_idx
      ON workspace_files (workspace_id, id)
      WHERE deleted_at IS NULL AND context = 'workspace' AND workspace_id IS NOT NULL`
    await connection`CREATE INDEX workspace_file_search_revision_pending_idx
      ON workspace_file_search_revision
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
    /** Deliberately not a whole number of pages, so the short final page ends the walk. */
    const files =
      2 * FILE_SEARCH_BACKFILL_PAGE_SIZE + Math.floor(FILE_SEARCH_BACKFILL_PAGE_SIZE / 2)
    const expectedPages = Math.ceil(files / FILE_SEARCH_BACKFILL_PAGE_SIZE)
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      SELECT md5(n::text), 'workspace-' || lpad((n % 7)::text, 2, '0'), 'workspace', '2026-09-16'
      FROM generate_series(1, ${files}) n`
    await connection`INSERT INTO workspace_files
      (id, workspace_id, context, deleted_at, content_updated_at)
      VALUES ('skipped-deleted', 'workspace-00', 'workspace', now(), '2026-09-16')`
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      VALUES ('skipped-context', 'workspace-00', 'execution', '2026-09-16')`

    let pages = 0
    let completed = false
    while (!completed) {
      await prepareWorkspaceFileSearchDispatch()
      pages += 1
      const [cursor] = await connection`SELECT completed_at FROM workspace_file_search_backfill`
      completed = cursor.completed_at !== null
      expect(pages).toBeLessThanOrEqual(expectedPages)
    }

    expect(pages).toBe(expectedPages)
    const [seeded] =
      await connection`SELECT count(*)::int AS total FROM workspace_file_search_revision`
    expect(seeded.total).toBe(files)
    const [skipped] = await connection`SELECT count(*)::int AS missed FROM workspace_files file
      WHERE file.context = 'workspace' AND file.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM workspace_file_search_revision revision
          WHERE revision.file_id = file.id)`
    expect(skipped.missed).toBe(0)
  }, 30_000)

  it('seeks the keyset index for the backfill cursor rather than filtering', async () => {
    await connection`INSERT INTO workspace_files (id, workspace_id, context, content_updated_at)
      SELECT md5(n::text), 'workspace-' || lpad((n % 7)::text, 2, '0'), 'workspace', '2026-09-16'
      FROM generate_series(1, ${2 * FILE_SEARCH_BACKFILL_PAGE_SIZE}) n`
    await connection`ANALYZE workspace_files`

    /** The first page leaves a cursor behind; the second is the one that has to seek to it. */
    await prepareWorkspaceFileSearchDispatch()
    statements.length = 0
    await prepareWorkspaceFileSearchDispatch()

    const walk = statements.find((statement) =>
      statement.query.includes('for share of "workspace_files"')
    )
    expect(walk).toBeDefined()
    expect(walk?.query).toContain('"workspace_files"."workspace_id", "workspace_files"."id") >')

    const plan = await connection.begin(async (tx) => {
      /**
       * At fixture scale a sequential scan is genuinely cheapest, so the planner is pinned to the
       * choice production makes on a table where it is not. What is asserted is the shape the
       * planner can still only reach from a row-wise cursor: the `OR` spelling stays a filter under
       * these same settings, which is the regression this guards.
       */
      await tx`SET LOCAL enable_seqscan = off`
      await tx`SET LOCAL enable_sort = off`
      const rows = await tx.unsafe(`EXPLAIN ${walk?.query}`, walk?.params as never[])
      return rows.map((row: Record<string, unknown>) => row['QUERY PLAN']).join('\n')
    })

    expect(plan).toContain('workspace_files_workspace_active_keyset_idx')
    expect(plan).toMatch(/Index Cond:.*ROW\(/)
  }, 30_000)

  it('claims from the ordered pending index rather than a hash join over the backlog', async () => {
    await seedQueue('workspace-1', 10_000)
    await connection`ANALYZE workspace_files`
    await connection`ANALYZE workspace_file_search_revision`

    statements.length = 0
    await prepareWorkspaceFileSearchDispatch()

    const claim = statements.find((statement) =>
      statement.query.includes('FOR UPDATE OF search_index SKIP LOCKED')
    )
    expect(claim).toBeDefined()

    const plan = await connection.begin(async (tx) => {
      /**
       * At fixture scale the planner already nests the join, so it is pinned to the choice
       * production makes when it misestimates the timestamp equi-join under `FOR UPDATE`. A join
       * spelling then hashes every file and every pending revision of the workspace and sorts the
       * whole backlog before the top-N cut; the correlated LATERAL cannot be flattened into that
       * join, so the claim stays an ordered walk of the pending index.
       */
      await tx`SET LOCAL enable_nestloop = off`
      const rows = await tx.unsafe(`EXPLAIN ${claim?.query}`, claim?.params as never[])
      return rows.map((row: Record<string, unknown>) => row['QUERY PLAN']).join('\n')
    })

    /** The locked candidate scan must be fed by the ordered index walk, not a sorted hash join. */
    expect(plan).toMatch(
      /LockRows[^\n]*\n\s*-> {2}Nested Loop[^\n]*\n\s*-> {2}Index Scan using workspace_file_search_revision_pending_idx/
    )
    expect(plan).not.toMatch(/Sort Key: search_index(_\d+)?\.updated_at/)
  }, 30_000)

  it('releases a claim abandoned before its enqueue once its handoff expires', async () => {
    await seedQueue('workspace-1', 3)
    /** Preparing without enqueueing is a dispatcher stopped between its commit and its enqueue. */
    const abandoned = await prepareWorkspaceFileSearchDispatch()
    expect(abandoned.payloads).toHaveLength(2)
    const deadlines = await connection`SELECT
      extract(epoch FROM handoff_expires_at - clock_timestamp()) * 1000 AS remaining_ms
      FROM workspace_file_search_revision WHERE dispatched_at IS NOT NULL`
    expect(deadlines).toHaveLength(2)
    for (const { remaining_ms } of deadlines) {
      expect(Number(remaining_ms)).toBeGreaterThan(FILE_SEARCH_DISPATCH_HANDOFF_MS - 10_000)
      expect(Number(remaining_ms)).toBeLessThanOrEqual(FILE_SEARCH_DISPATCH_HANDOFF_MS)
    }
    /** Until the deadline passes, the claims keep holding their workspace's slots. */
    expect(await prepareWorkspaceFileSearchDispatch()).toMatchObject({
      payloads: [],
      reapedClaims: 0,
      abandonedClaims: 0,
    })

    await connection`UPDATE workspace_file_search_revision
      SET handoff_expires_at = clock_timestamp() - interval '1 millisecond'
      WHERE dispatched_at IS NOT NULL`
    const recovered = await prepareWorkspaceFileSearchDispatch()
    expect(recovered.reapedClaims).toBe(2)
    expect(recovered.abandonedClaims).toBe(2)
    expect(recovered.payloads).toHaveLength(2)
    const abandonedToken = abandoned.payloads[0].dispatchToken
    if (!abandonedToken) throw new Error('Every claim carries its dispatch token')
    expect(recovered.payloads.map((payload) => payload.dispatchToken)).not.toContain(abandonedToken)
    const [left] = await connection`SELECT count(*)::int AS claims
      FROM workspace_file_search_revision WHERE dispatched_at = ${abandonedToken}::timestamp`
    expect(left.claims).toBe(0)
    const [unclaimed] = await connection`SELECT count(*)::int AS deadlines
      FROM workspace_file_search_revision
      WHERE dispatched_at IS NULL AND handoff_expires_at IS NOT NULL`
    expect(unclaimed.deadlines).toBe(0)
  })

  it('leaves an enqueued claim to its run until the stale-dispatch window', async () => {
    await seedQueue('workspace-1', 1)
    /** A millisecond revision, as file writes store, so the handoff must match it exactly. */
    await connection`UPDATE workspace_files SET content_updated_at = '2026-09-16 12:34:56.789'`
    await connection`UPDATE workspace_file_search_revision
      SET source_content_updated_at = '2026-09-16 12:34:56.789'`
    mocks.batchTrigger.mockResolvedValueOnce({ batchId: 'batch-1' })
    await expect(dispatchWorkspaceFileSearchIndexJobs()).resolves.toMatchObject({
      dispatchedFiles: 1,
    })
    const [claim] = await connection`SELECT handoff_expires_at FROM workspace_file_search_revision
      WHERE dispatched_at IS NOT NULL`
    expect(claim.handoff_expires_at).toBeNull()

    /** A run can wait in its queue or back off for an hour without being taken for abandoned. */
    await connection`UPDATE workspace_file_search_revision
      SET dispatched_at = dispatched_at - interval '1 hour' WHERE dispatched_at IS NOT NULL`
    expect((await prepareWorkspaceFileSearchDispatch()).reapedClaims).toBe(0)
    await connection`UPDATE workspace_file_search_revision
      SET dispatched_at = dispatched_at - ${FILE_SEARCH_INDEX_STALE_DISPATCH_MS} * interval '1 millisecond'
      WHERE dispatched_at IS NOT NULL`
    expect(await prepareWorkspaceFileSearchDispatch()).toMatchObject({
      reapedClaims: 1,
      abandonedClaims: 0,
    })
  })

  it('does not complete the handoff of a claim released and claimed again meanwhile', async () => {
    await seedQueue('workspace-1', 1)
    mocks.batchTrigger.mockImplementationOnce(async () => {
      /** Another dispatch releases this claim and claims the revision again under its own token. */
      await connection`UPDATE workspace_file_search_revision
        SET dispatched_at = '2099-01-01', handoff_expires_at = '2099-01-01'
        WHERE dispatched_at IS NOT NULL`
      return { batchId: 'batch-1' }
    })

    await dispatchWorkspaceFileSearchIndexJobs()

    const [claim] = await connection`SELECT handoff_expires_at::text AS handoff
      FROM workspace_file_search_revision WHERE dispatched_at IS NOT NULL`
    expect(claim.handoff).toBe('2099-01-01 00:00:00')
  })

  it('records the handoff around a claim another transaction holds instead of waiting', async () => {
    await seedQueue('workspace-1', 2)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let holder: Promise<unknown> | undefined
    mocks.batchTrigger.mockImplementationOnce(async () => {
      /** A run beginning its build holds its claim while the handoff is being recorded. */
      let locked = () => {}
      const lockReady = new Promise<void>((resolve) => {
        locked = resolve
      })
      holder = connection.begin(async (tx) => {
        await tx`SELECT file_id FROM workspace_file_search_revision
          WHERE file_id = 'workspace-1-000001' FOR UPDATE`
        locked()
        await held
      })
      await lockReady
      return { batchId: 'batch-1' }
    })
    try {
      await expect(dispatchWorkspaceFileSearchIndexJobs()).resolves.toMatchObject({
        dispatchedFiles: 2,
      })
      const claims = await connection`SELECT file_id,
        handoff_expires_at IS NOT NULL AS pending_handoff
        FROM workspace_file_search_revision ORDER BY file_id`
      expect([...claims]).toEqual([
        { file_id: 'workspace-1-000001', pending_handoff: true },
        { file_id: 'workspace-1-000002', pending_handoff: false },
      ])
    } finally {
      release()
      await holder
    }
  })

  it('keeps enqueued claims when recording their handoff fails', async () => {
    await seedQueue('workspace-1', 1)
    await connection`CREATE FUNCTION reject_handoff() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'handoff unavailable';
      END
    $$`
    await connection`CREATE TRIGGER reject_handoff BEFORE UPDATE OF handoff_expires_at
      ON workspace_file_search_revision FOR EACH ROW
      WHEN (OLD.handoff_expires_at IS NOT NULL AND NEW.handoff_expires_at IS NULL
        AND NEW.dispatched_at IS NOT NULL)
      EXECUTE FUNCTION reject_handoff()`
    try {
      mocks.batchTrigger.mockResolvedValueOnce({ batchId: 'batch-1' })
      await expect(dispatchWorkspaceFileSearchIndexJobs()).resolves.toMatchObject({
        dispatchedFiles: 1,
      })
      const [claim] = await connection`SELECT dispatched_at, handoff_expires_at
        FROM workspace_file_search_revision`
      expect(claim.dispatched_at).not.toBeNull()
      expect(claim.handoff_expires_at).not.toBeNull()
    } finally {
      await connection`DROP TRIGGER reject_handoff ON workspace_file_search_revision`
      await connection`DROP FUNCTION reject_handoff()`
    }
  })

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
    const [index] =
      await connection`SELECT dispatched_at, handoff_expires_at FROM workspace_file_search_revision
      WHERE file_id = ${fileId}`
    expect(index.dispatched_at).toBeNull()
    expect(index.handoff_expires_at).toBeNull()
    const [queued] = await connection`SELECT workspace_id FROM workspace_file_search_dispatch_queue
      WHERE workspace_id = ${workspaceId}`
    expect(queued.workspace_id).toBe(workspaceId)
    const timeouts = await connection`SELECT * FROM cleanup_timeouts`
    expect([...timeouts]).toEqual([
      { lock_timeout: '0', statement_timeout: '0', transaction_timeout: '0' },
    ])
  })
})
