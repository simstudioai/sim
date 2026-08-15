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

/**
 * Applies every guard in ONE round-trip. Each awaited `trx.execute` is its own round-trip, and
 * every user-table read opens a transaction, so issuing these separately cost 2–3 round-trips on
 * every page, count, and drain batch.
 *
 * `set_config(name, value, is_local => true)` is exactly `SET LOCAL` — transaction-scoped, dying
 * with the commit, and reverting the same way on a savepoint rollback — but it is a function call,
 * so several fit in one `SELECT`. It also takes the values as bound parameters, which `SET LOCAL`
 * cannot. That is the reason they must be one statement rather than semicolon-joined: a bound
 * parameter forces the extended protocol, which rejects multiple commands per message.
 *
 * The guards are the first statement in the transaction, so an invalid value aborts it before
 * `fn(trx)` can run — there is no path where a read proceeds unguarded.
 */
async function setReadGuards(trx: DbTransaction, seqscanOff: boolean): Promise<void> {
  /**
   * Only ever set to `off`, never explicitly to `on` — the unflagged path must leave whatever
   * the server default is, exactly as the separate `SET LOCAL enable_seqscan = off` did.
   */
  const seqscan = seqscanOff ? sql`, set_config('enable_seqscan', 'off', true)` : sql``
  await trx.execute(sql`
    select
      set_config('statement_timeout', ${`${READ_STATEMENT_TIMEOUT_MS}ms`}, true),
      set_config('lock_timeout', ${`${READ_LOCK_TIMEOUT_MS}ms`}, true)${seqscan}
  `)
}

/**
 * Runs a user-table read inside a transaction that always caps `statement_timeout`
 * / `lock_timeout` (see {@link setReadGuards}). Pass `seqscanOff` for queries
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
    await setReadGuards(trx, opts?.seqscanOff ?? false)
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
