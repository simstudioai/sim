/**
 * Shared transaction / locking helpers for the table service layer.
 *
 * Internal module: not exposed via the `@/lib/table` barrel. Consumers import
 * directly from `@/lib/table/tx`.
 */

import { sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/table/planner'

const TIMEOUT_CAP_MS = 10 * 60_000

/**
 * Sets per-transaction Postgres timeouts via `SET LOCAL`.
 *
 * `lock_timeout` is the critical one: without it, a waiter inherits the full
 * `statement_timeout` clock, so one stuck writer can drain the pool.
 *
 * Safe under pgBouncer transaction pooling — `SET LOCAL` is transaction-scoped
 * and cleared at COMMIT/ROLLBACK before the session returns to the pool.
 */
export async function setTableTxTimeouts(
  trx: DbTransaction,
  opts?: { statementMs?: number; lockMs?: number; idleMs?: number }
) {
  const s = opts?.statementMs ?? 10_000
  const l = opts?.lockMs ?? 3_000
  const i = opts?.idleMs ?? 5_000
  await trx.execute(sql.raw(`SET LOCAL statement_timeout = '${s}ms'`))
  await trx.execute(sql.raw(`SET LOCAL lock_timeout = '${l}ms'`))
  await trx.execute(sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${i}ms'`))
}

/**
 * Scales `statement_timeout` to the expected row-count work.
 *
 * Bulk operations that rewrite JSONB or cascade row triggers (e.g.
 * `replaceTableRows`, `deleteColumn`, `renameColumn`) scale roughly linearly
 * with row count. A fixed cap would regress large-table users who never saw a
 * timeout before `SET LOCAL` was introduced. This helper picks
 * `max(baseMs, rowCount * perRowMs)`, capped at 10 minutes so a single
 * runaway transaction cannot indefinitely pin a pool connection.
 */
export function scaledStatementTimeoutMs(
  rowCount: number,
  opts: { baseMs: number; perRowMs: number }
): number {
  const safeRowCount = Math.max(0, rowCount)
  return Math.min(TIMEOUT_CAP_MS, Math.max(opts.baseMs, safeRowCount * opts.perRowMs))
}
