import { db } from '@sim/db'
import { sql } from 'drizzle-orm'

export type DbExecutor = typeof db | DbTransaction
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Runs `fn` with seq scans penalized (`SET LOCAL`, so the flag dies with the
 * transaction). JSONB predicates and sort keys (`->>` extraction, `@>`
 * containment, lateral `jsonb_each_text`) are opaque to the planner — it
 * estimates a handful of matching rows and picks a parallel seq scan over the
 * entire shared `user_table_rows` relation (every tenant's rows) instead of the
 * tenant's own index. Measured on a 1M-row table inside a 12M-row relation:
 * filtered count 12.7s → 1.0s, sorted page 9.7s → 0.76s, filtered bulk select
 * 14.4s → tenant-bounded. The flag only penalizes the plan shape: if no index
 * plan exists, the seq scan still runs.
 */
export async function withSeqscanOff<T>(fn: (trx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.execute(sql`SET LOCAL enable_seqscan = off`)
    return fn(trx)
  })
}
