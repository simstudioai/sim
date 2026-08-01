import { db } from '@sim/db'
import { sql } from 'drizzle-orm'

export type DbExecutor = typeof db | DbTransaction
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Statement/lock timeout for user-table READ queries. Reads are bounded tighter
 * than the write path because filter shape is caller-controlled: a public API
 * key can drive an arbitrary predicate (a catastrophic-backtracking `match`
 * regex, a wide unindexed scan), and an untimed read pins a connection from the
 * small shared `web` pool — one abusive key can starve every tenant. `SET LOCAL`
 * scopes both to the surrounding transaction, so they die when it commits.
 */
const READ_STATEMENT_TIMEOUT_MS = 15_000
const READ_LOCK_TIMEOUT_MS = 3_000

async function setReadTimeouts(trx: DbTransaction): Promise<void> {
  await trx.execute(sql.raw(`SET LOCAL statement_timeout = '${READ_STATEMENT_TIMEOUT_MS}ms'`))
  await trx.execute(sql.raw(`SET LOCAL lock_timeout = '${READ_LOCK_TIMEOUT_MS}ms'`))
}

/**
 * Runs a user-table read inside a transaction that always caps `statement_timeout`
 * / `lock_timeout` (see {@link setReadTimeouts}). Pass `seqscanOff` for queries
 * with no tenant-bounded index plan — custom column sorts and filtered counts —
 * where the planner otherwise seq-scans the whole shared `user_table_rows`
 * relation (every tenant's rows); see {@link withSeqscanOff} for the measured
 * deltas. Default-order keyset/offset pages already stream the
 * `(table_id, order_key, id)` index, so they take the timeout without the flag.
 */
export async function withReadGuards<T>(
  fn: (trx: DbTransaction) => Promise<T>,
  opts?: { seqscanOff?: boolean }
): Promise<T> {
  return db.transaction(async (trx) => {
    await setReadTimeouts(trx)
    if (opts?.seqscanOff) await trx.execute(sql`SET LOCAL enable_seqscan = off`)
    return fn(trx)
  })
}

/**
 * Runs `fn` with seq scans penalized (`SET LOCAL`, so the flag dies with the
 * transaction) AND the read timeouts above. JSONB predicates and sort keys
 * (`->>` extraction, `@>` containment, lateral `jsonb_each_text`) are opaque to
 * the planner — it estimates a handful of matching rows and picks a parallel
 * seq scan over the entire shared `user_table_rows` relation (every tenant's
 * rows) instead of the tenant's own index. Measured on a 1M-row table inside a
 * 12M-row relation: filtered count 12.7s → 1.0s, sorted page 9.7s → 0.76s,
 * filtered bulk select 14.4s → tenant-bounded. The flag only penalizes the plan
 * shape: if no index plan exists, the seq scan still runs (and the timeout caps it).
 */
export async function withSeqscanOff<T>(fn: (trx: DbTransaction) => Promise<T>): Promise<T> {
  return withReadGuards(fn, { seqscanOff: true })
}
