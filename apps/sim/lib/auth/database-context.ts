import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '@sim/db'
import type { DbOrTx } from '@/lib/db/types'

const authDatabase = new AsyncLocalStorage<DbOrTx>()

/** The Drizzle executor backing the current Better Auth transaction, or the root database. */
export function getAuthDatabase(): DbOrTx {
  return authDatabase.getStore() ?? db
}

/** Keeps database hooks on the adapter's connection so they can see uncommitted auth records. */
export function runWithAuthDatabase<T>(database: DbOrTx, work: () => Promise<T>): Promise<T> {
  return authDatabase.run(database, work)
}
