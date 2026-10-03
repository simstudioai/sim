/**
 * Set TEST_DATABASE_URL to a local PostgreSQL database.
 *
 * Proves the fork module's lock ORDER is acyclic, against real Postgres deadlock detection.
 *
 * The cycle this guards: taking `lockForkRevision` (which holds `FOR UPDATE` on the source
 * `workspace` row) BEFORE the shared lineage lock in `createFork`, while `unlinkForkEdge`
 * takes the lineage lock exclusively and then UPDATEs that same row. Only two real sessions
 * racing on a real server can observe it.
 *
 * Both sessions drive the PRODUCTION lock helpers (`setForkLockTimeout`,
 * `acquireForkLineageLock`, `lockForkRevision`) rather than copies of their SQL, so a
 * change to the advisory-lock key, or to what `lockForkRevision` locks, is carried into
 * this test automatically. The companion assertion that `createFork` calls them in this
 * order lives beside it in `create-fork.test.ts`; together they cover "this order is the
 * correct one" and "the fork actually follows it".
 *
 * The suite runs BOTH orders and asserts they differ: the pre-fix order must deadlock, the
 * shipped order must not. Asserting only "no deadlock" would pass even if the locks never
 * contended at all.
 */

import * as schema from '@sim/db/schema'
import { workspace } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage, getPostgresCancellationReason } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { lockForkRevision } from '@/ee/workspace-forking/application/revision'
import {
  acquireForkLineageLock,
  setForkLockTimeout,
} from '@/ee/workspace-forking/lib/lineage/lineage'

const databaseUrl = readTestDatabaseUrl()

const SOURCE_WORKSPACE_ID = 'root-ws'

/** The server's cancellation reason (`deadlock`, `lock_timeout`, ...) or the raw message. */
function describeFailure(error: unknown): string {
  return getPostgresCancellationReason(error) ?? getErrorMessage(error)
}

interface CheckResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}
const report: CheckResult[] = []

describe('fork lock ordering in PostgreSQL', () => {
  const testSchema = `fork_lock_${generateShortId()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()}`
  let setup: ReturnType<typeof postgres>
  const connections: ReturnType<typeof postgres>[] = []

  /**
   * A drizzle executor pinned to this suite's schema, on its own backend. The raw client
   * comes back too so a race can close its own sessions; `connections` is the backstop that
   * closes anything a failing test left open.
   */
  function connect(): { executor: DbOrTx; client: ReturnType<typeof postgres> } {
    const client = postgres(databaseUrl, {
      max: 1,
      connection: { search_path: testSchema },
      onnotice: () => {},
    })
    connections.push(client)
    return { executor: drizzle(client, { schema }) as DbOrTx, client }
  }

  beforeAll(async () => {
    setup = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    await setup.unsafe(`CREATE SCHEMA ${testSchema}`)
    // Exactly the tables `lockForkRevision` locks, so the production helper runs unmodified.
    await setup.unsafe(`
      SET search_path TO ${testSchema};
      CREATE TABLE workspace (id text PRIMARY KEY, updated_at timestamp DEFAULT now());
      CREATE TABLE workflow (id text PRIMARY KEY, workspace_id text);
      CREATE TABLE workflow_blocks (id text PRIMARY KEY, workflow_id text);
      CREATE TABLE workflow_edges (id text PRIMARY KEY, workflow_id text);
      CREATE TABLE workflow_subflows (id text PRIMARY KEY, workflow_id text);
      CREATE TABLE workflow_deployment_version (
        id text PRIMARY KEY, workflow_id text, is_active boolean DEFAULT true
      );
      INSERT INTO workspace (id) VALUES ('${SOURCE_WORKSPACE_ID}');
      INSERT INTO workflow (id, workspace_id) VALUES ('wf-1', '${SOURCE_WORKSPACE_ID}');
      INSERT INTO workflow_deployment_version (id, workflow_id) VALUES ('dv-1', 'wf-1');
    `)
  })

  afterAll(async () => {
    await Promise.all(connections.map((client) => client.end({ timeout: 5 })))
    await setup.unsafe(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`)
    await setup.end({ timeout: 5 })
    const path = process.env.FORK_LOCK_REPORT_PATH
    if (path) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, JSON.stringify({ suite: 'fork-lock-order', checks: report }, null, 2))
    }
  })

  /**
   * Waits until THIS unlink transaction's own backend is blocked on a lock, so the fork's
   * second acquisition races a real holder rather than an arbitrary sleep.
   *
   * Filtered to one pid on purpose. Counting any Lock waiter on the database would let an
   * unrelated session (a parallel suite, a leftover connection) release the barrier before
   * the unlink had blocked, so the pre-fix control could proceed with its cycle still open
   * and stop being a reliable negative.
   *
   * Both orders reach this state - pre-fix the unlink blocks on the row write, shipped it
   * blocks on the lineage lock - which is what lets one barrier serve both. Never blocking
   * means the race did not set up, so it throws rather than quietly proceeding.
   */
  async function waitForBlockedBackend(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await setup`
        SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE pid = ${pid} AND wait_event_type = 'Lock'`
      if ((row?.blocked ?? 0) > 0) return
      await sleep(50)
    }
    throw new Error(`Unlink backend ${pid} never blocked on a lock; the race did not set up`)
  }

  /**
   * Races the fork's lock sequence against the unlink's, holding the fork's first lock
   * while the unlink runs so the two contend exactly as they do in production.
   *
   * `forkTakesLineageFirst` is the whole experiment: `true` is the shipped order, `false`
   * reproduces the pre-fix one. Returns the error that aborted a session, or null.
   */
  async function raceForkAgainstUnlink(forkTakesLineageFirst: boolean): Promise<string | null> {
    const { executor: forkDb, client: forkClient } = connect()
    const { executor: unlinkDb, client: unlinkClient } = connect()
    const forkHoldsFirstLock = createDeferred<void>()
    // `null` means the unlink never got far enough to report a backend, so there is nothing
    // to wait on. Every barrier here is settled on the failure path as well as the happy
    // one: an unsettled deferred turns a clean database error into a test timeout, which
    // hides the very diagnostics a concurrency test exists to give.
    const unlinkBackendPid = createDeferred<number | null>()
    const unlinkMayFinish = createDeferred<void>()
    let failure: string | null = null

    // The two locks `createFork` takes, as production takes them: rank 2 (shared) then rank 5.
    const takeForkLineageLock = (tx: DbTransaction) =>
      acquireForkLineageLock(tx, SOURCE_WORKSPACE_ID, { shared: true })
    const takeRevisionLock = (tx: DbTransaction) =>
      lockForkRevision(tx, { sourceWorkspaceId: SOURCE_WORKSPACE_ID })

    const forkSession = forkDb
      .transaction(async (tx) => {
        await setForkLockTimeout(tx)
        await (forkTakesLineageFirst ? takeForkLineageLock(tx) : takeRevisionLock(tx))
        forkHoldsFirstLock.resolve()
        // Only reach for the second lock once the unlink is demonstrably blocked, so the
        // pre-fix cycle is closed rather than merely likely.
        await unlinkMayFinish.promise
        await (forkTakesLineageFirst ? takeRevisionLock(tx) : takeForkLineageLock(tx))
      })
      .catch((error: unknown) => {
        failure ??= describeFailure(error)
      })
      // Releases the barrier below if this session died before taking its first lock.
      // `createDeferred`'s resolve is a no-op once settled, so the happy path is unchanged.
      .finally(() => forkHoldsFirstLock.resolve())

    const unlinkSession = forkHoldsFirstLock.promise
      .then(() =>
        unlinkDb
          .transaction(async (tx) => {
            await setForkLockTimeout(tx)
            // Publish this transaction's backend before it can block, so the barrier waits
            // on exactly this session rather than on whatever else the database is doing.
            const [self] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
            unlinkBackendPid.resolve(Number(self?.pid))
            // `unlinkForkEdge` takes the lineage lock exclusively, then writes the workspace row.
            await acquireForkLineageLock(tx, SOURCE_WORKSPACE_ID)
            await tx
              .update(workspace)
              .set({ updatedAt: new Date() })
              .where(eq(workspace.id, SOURCE_WORKSPACE_ID))
          })
          .catch((error: unknown) => {
            failure ??= describeFailure(error)
          })
      )
      // Covers a connection that drops before `pg_backend_pid()` returns.
      .finally(() => unlinkBackendPid.resolve(null))

    try {
      await forkHoldsFirstLock.promise
      const unlinkPid = await unlinkBackendPid.promise
      // A session that already failed cannot go on to block, so skip the barrier and let
      // its error be what the test reports.
      if (failure === null && unlinkPid !== null) await waitForBlockedBackend(unlinkPid)
    } finally {
      // Both sessions must be released and drained even when the barrier itself threw,
      // or the fork transaction sits on `unlinkMayFinish` and the suite hangs.
      unlinkMayFinish.resolve()
      await Promise.all([forkSession, unlinkSession])
      await Promise.all([forkClient.end({ timeout: 5 }), unlinkClient.end({ timeout: 5 })])
    }
    return failure
  }

  async function check(name: string, run: () => Promise<void>) {
    const startedAt = Date.now()
    try {
      await run()
      report.push({ name, status: 'passed', durationMs: Date.now() - startedAt })
    } catch (error) {
      report.push({
        name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  it('completes both transactions when fork takes the lineage lock first (shipped order)', async () => {
    await check('shipped-order-no-deadlock', async () => {
      expect(await raceForkAgainstUnlink(true)).toBeNull()
    })
  })

  /**
   * The negative control. Without it the test above could pass because the locks never
   * actually contend - this proves the pair genuinely conflicts, so the shipped order's
   * success is the ordering's doing and not an artifact of the fixture.
   */
  it('deadlocks when fork takes the revision lock first (the reported pre-fix order)', async () => {
    await check('pre-fix-order-deadlocks', async () => {
      const failure = await raceForkAgainstUnlink(false)
      expect(failure).toBe('deadlock')
    })
  })
})
