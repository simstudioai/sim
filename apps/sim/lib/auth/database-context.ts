import { AsyncLocalStorage } from 'node:async_hooks'
import { type db, dbFor } from '@sim/db'
import type { DbOrTx } from '@/lib/db/types'

const authDatabase = new AsyncLocalStorage<DbOrTx>()

/**
 * The auth pool's root client. Session, adapter, and API-key lookups gate every
 * authenticated request, so they keep their own connections when slow work
 * saturates the process pool.
 */
export function getAuthPool(): typeof db {
  return dbFor('auth')
}

/** The Drizzle executor backing the current Better Auth transaction, or the auth pool. */
export function getAuthDatabase(): DbOrTx {
  return authDatabase.getStore() ?? getAuthPool()
}

/** Keeps database hooks on the adapter's connection so they can see uncommitted auth records. */
export function runWithAuthDatabase<T>(database: DbOrTx, work: () => Promise<T>): Promise<T> {
  return authDatabase.run(database, work)
}
