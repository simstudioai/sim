import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import type { BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  type AuthDatabase,
  guardOAuthProviderWrites,
} from '@/lib/auth/oauth-provider-adapter-guard'
import { guardSubscriptionPlanWrites } from '@/lib/auth/stripe-adapter-guard'

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>

/**
 * Builds every Better Auth adapter surface, including transactional callbacks,
 * with Sim's write invariants applied to the actual Drizzle connection in use.
 */
export function createSimAuthAdapter(
  options: BetterAuthOptions,
  database: AuthDatabase = db,
  inTransaction = false
): BetterAuthAdapter {
  const base = drizzleAdapter(database, {
    provider: 'pg',
    schema,
    transaction: false,
  })(options)
  const guarded = guardSubscriptionPlanWrites(guardOAuthProviderWrites(base, database))
  if (inTransaction) return guarded

  guarded.transaction = (callback) =>
    database.transaction(async (tx) => {
      const transactionAdapter = createSimAuthAdapter(options, tx, true)
      const { transaction: _transaction, ...surface } = transactionAdapter
      return callback(surface)
    })
  return guarded
}
