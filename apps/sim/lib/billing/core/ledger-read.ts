import { sql } from 'drizzle-orm'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'
import { DatabaseReadDeadlineError, withDatabaseReadRetry } from '@/lib/db/read-retry'
import type { DbClient, DbTransaction } from '@/lib/db/types'

/**
 * Runs one aggregate over a payer's usage ledger in a transaction of its own, sharing
 * {@link USAGE_LEDGER_STATEMENT_TIMEOUT_MS} across retries and statement execution. Pool wait
 * is deducted on acquisition; an exhausted budget refuses the read. `SET LOCAL` scopes the bound,
 * so it ends with the read and never reaches the pool. Every sum over a payer's billing period
 * reads through here, whether it admits a run, closes a cycle or previews a bill: a payer whose
 * period has grown past what one statement can sum within the bound fails at the database
 * instead of holding a connection without limit, and a caller that admits on the answer can
 * size its own deadline from the bound. Reads keyed to one execution or one stamped period
 * boundary, and the platform-wide admin analytics, are not period sums and read directly.
 */
export function readLedgerBounded<T>(
  executor: DbClient,
  read: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return withDatabaseReadRetry(
    (remainingMs) => {
      const attemptStartedAt = Date.now()
      return executor.transaction(
        async (tx) => {
          const timeoutMs = Math.floor(
            (remainingMs ?? USAGE_LEDGER_STATEMENT_TIMEOUT_MS) - (Date.now() - attemptStartedAt)
          )
          if (timeoutMs <= 0) throw new DatabaseReadDeadlineError()
          await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${timeoutMs}ms'`))
          return read(tx)
        },
        { accessMode: 'read only' }
      )
    },
    { label: 'usage ledger', maxAttempts: 2, maxElapsedMs: USAGE_LEDGER_STATEMENT_TIMEOUT_MS }
  )
}
