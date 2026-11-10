import type { db } from '@sim/db'
import { sleep } from '@sim/utils/helpers'
import { sql } from 'drizzle-orm'

type FixtureDatabase = typeof db
type FixtureExecutor =
  | FixtureDatabase
  | Parameters<Parameters<FixtureDatabase['transaction']>[0]>[0]

/** The Postgres backend running `executor`'s statements: call it inside the transaction that holds a lock. */
export async function backendPid(executor: FixtureExecutor): Promise<number> {
  const [{ pid }] = await executor.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
  return pid
}

/**
 * Resolves once a statement is parked behind the transaction on backend `holderPid`: the racing
 * request a test released in parallel has reached the lock and waits on it. Scoped to that holder,
 * so a lock wait anywhere else in a shared database never stands in for it.
 */
export async function waitForBackendBlockedBy(
  database: FixtureDatabase,
  holderPid: number
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [{ waiting }] = await database.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND ${holderPid}::int = ANY(pg_blocking_pids(pid))
    `)
    if (waiting > 0) return
    await sleep(25)
  }
  throw new Error(`no statement ever waited on backend ${holderPid}`)
}
