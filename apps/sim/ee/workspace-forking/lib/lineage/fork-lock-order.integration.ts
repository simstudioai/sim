/**
 * Set TEST_DATABASE_URL to a local PostgreSQL database.
 *
 * Proves the fork module's lock ORDER is acyclic, against real Postgres deadlock detection.
 *
 * The cycle this guards: `createFork` used to take `lockForkRevision` (which holds
 * `FOR UPDATE` on the source `workspace` row) BEFORE `acquireForkLineageLock`, while
 * `unlinkForkEdge` takes the lineage lock and then UPDATEs that same row. Two reviewers
 * reported it independently and no unit test could see it - only two real sessions racing
 * on a real server can.
 *
 * The suite runs BOTH orders and asserts they differ: the pre-fix order must deadlock, the
 * shipped order must not. Asserting only "no deadlock" would pass even if the locks never
 * contended at all, which is exactly the class of vacuous check that let this bug through
 * the earlier review rounds.
 */

import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

/** Short so a genuine cycle surfaces fast; production uses `setForkLockTimeout`'s 10s. */
const LOCK_TIMEOUT_MS = 3_000
const ROOT_WORKSPACE_ID = 'root-ws'

/** Byte-identical to `acquireForkLineageLock`'s statement (rank 2). */
const LINEAGE_LOCK = `select pg_advisory_xact_lock(hashtextextended('fork-lineage:${ROOT_WORKSPACE_ID}', 0))`
/** The `FOR UPDATE` that `lockForkRevision` (rank 5) takes on the source workspace row. */
const ROW_LOCK = `SELECT id FROM workspace WHERE id = '${ROOT_WORKSPACE_ID}' ORDER BY id FOR UPDATE`
/** The write `unlinkForkEdge` performs while holding the lineage lock. */
const ROW_WRITE = `UPDATE workspace SET updated_at = now() WHERE id = '${ROOT_WORKSPACE_ID}'`

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

  const connect = () =>
    postgres(databaseUrl, { max: 1, connection: { search_path: testSchema }, onnotice: () => {} })

  beforeAll(async () => {
    setup = postgres(databaseUrl, { max: 1, onnotice: () => {} })
    await setup.unsafe(`CREATE SCHEMA ${testSchema}`)
    await setup.unsafe(
      `CREATE TABLE ${testSchema}.workspace (id text PRIMARY KEY, updated_at timestamp DEFAULT now())`
    )
    await setup.unsafe(`INSERT INTO ${testSchema}.workspace (id) VALUES ('${ROOT_WORKSPACE_ID}')`)
  })

  afterAll(async () => {
    await setup.unsafe(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`)
    await setup.end({ timeout: 5 })
    const path = process.env.FORK_LOCK_REPORT_PATH
    if (path) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, JSON.stringify({ suite: 'fork-lock-order', checks: report }, null, 2))
    }
  })

  /**
   * Waits until some backend on this database is genuinely blocked on a lock, so the second
   * acquisition races a real holder rather than an arbitrary sleep. Both orders reach this
   * state (pre-fix the unlink blocks on the row write, shipped it blocks on the lineage
   * lock), which is what lets one barrier serve both.
   */
  async function waitForBlockedBackend(): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await setup`
        SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`
      if ((row?.blocked ?? 0) > 0) return true
      await sleep(50)
    }
    return false
  }

  /**
   * Runs the fork session against the unlink session, holding the fork's first lock while
   * the unlink runs, so the two contend exactly as they do in production.
   *
   * `forkTakesLineageFirst` is the whole experiment: `true` is the shipped order, `false`
   * reproduces the pre-fix one. Returns the error that aborted a session, or null.
   */
  async function raceForkAgainstUnlink(forkTakesLineageFirst: boolean): Promise<string | null> {
    const forkDb = connect()
    const unlinkDb = connect()
    const forkHoldsFirstLock = createDeferred<void>()
    const unlinkMayFinish = createDeferred<void>()
    let failure: string | null = null

    const forkSession = forkDb
      .begin(async (tx) => {
        await tx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
        await tx.unsafe(forkTakesLineageFirst ? LINEAGE_LOCK : ROW_LOCK)
        forkHoldsFirstLock.resolve()
        // Only reach for the second lock once the unlink is demonstrably blocked, so the
        // pre-fix cycle is closed rather than merely likely.
        await unlinkMayFinish.promise
        await tx.unsafe(forkTakesLineageFirst ? ROW_LOCK : LINEAGE_LOCK)
      })
      .catch((error: Error) => {
        failure ??= error.message
      })

    const unlinkSession = forkHoldsFirstLock.promise.then(() =>
      unlinkDb
        .begin(async (tx) => {
          await tx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
          // `unlinkForkEdge` always takes the lineage lock first, then writes the row.
          await tx.unsafe(LINEAGE_LOCK)
          await tx.unsafe(ROW_WRITE)
        })
        .catch((error: Error) => {
          failure ??= error.message
        })
    )

    await forkHoldsFirstLock.promise
    await waitForBlockedBackend()
    unlinkMayFinish.resolve()

    await Promise.all([forkSession, unlinkSession])
    await Promise.all([forkDb.end({ timeout: 5 }), unlinkDb.end({ timeout: 5 })])
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
  it('deadlocks when fork takes the workspace row first (the reported pre-fix order)', async () => {
    await check('pre-fix-order-deadlocks', async () => {
      const failure = await raceForkAgainstUnlink(false)
      expect(failure).toMatch(/deadlock detected|canceling statement due to lock timeout/i)
    })
  })
})
