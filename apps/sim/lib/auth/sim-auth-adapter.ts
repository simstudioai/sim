import { db } from '@sim/db'
import { withInsertColumns } from '@sim/db/insert-columns'
import * as schema from '@sim/db/schema'
import type { BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { runWithAuthDatabase } from '@/lib/auth/database-context'
import {
  type AuthDatabase,
  guardOAuthProviderWrites,
} from '@/lib/auth/oauth-provider-adapter-guard'
import { guardSubscriptionPlanWrites } from '@/lib/auth/stripe-adapter-guard'

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>

/** Better Auth's implicit reads, INSERT defaults, and RETURNING must use live columns. */
const AUTH_SCHEMA = {
  ...schema,
  organization: withInsertColumns(schema.organization, schema.organizationColumns),
}

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
    schema: AUTH_SCHEMA,
    transaction: false,
  })(options)
  const guarded = guardSubscriptionPlanWrites(guardOAuthProviderWrites(base, database))
  if (inTransaction) return guarded

  guarded.transaction = (callback) =>
    database.transaction(async (tx) => {
      const transactionAdapter = createSimAuthAdapter(options, tx, true)
      const { transaction: _transaction, ...surface } = transactionAdapter
      return runWithAuthDatabase(tx, () => callback(surface))
    })
  return guarded
}
