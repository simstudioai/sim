import { sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  FILE_SEARCH_LOCK_TIMEOUT_MS,
  FILE_SEARCH_STATEMENT_TIMEOUT_MS,
} from '@/lib/workspace-files/search/constants'

/** PostgreSQL 16 uses statement and idle guards; PostgreSQL 17 also bounds total transaction time. */
export async function configureFileSearchTransaction(
  tx: DbTransaction,
  {
    statementTimeout = FILE_SEARCH_STATEMENT_TIMEOUT_MS,
    lockTimeout = FILE_SEARCH_LOCK_TIMEOUT_MS,
    transactionTimeout = statementTimeout,
  }: { statementTimeout?: number; lockTimeout?: number; transactionTimeout?: number } = {}
): Promise<void> {
  await tx.execute(sql`SELECT
    set_config('statement_timeout', ${`${statementTimeout}ms`}, true),
    set_config('lock_timeout', ${`${lockTimeout}ms`}, true),
    set_config(
      CASE WHEN current_setting('transaction_timeout', true) IS NULL
        THEN 'idle_in_transaction_session_timeout' ELSE 'transaction_timeout' END,
      ${`${transactionTimeout}ms`}, true
    )`)
}
