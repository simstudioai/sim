import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import type { BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { runWithAuthDatabase } from '@/lib/auth/database-context'
import {
  type AuthDatabase,
  guardOAuthProviderWrites,
} from '@/lib/auth/oauth-provider-adapter-guard'
import { lockSsoProvider } from '@/lib/auth/sso/provider-lock'
import { guardSubscriptionPlanWrites } from '@/lib/auth/stripe-adapter-guard'
import type { DbTransaction } from '@/lib/db/types'

type BetterAuthAdapter = ReturnType<ReturnType<typeof drizzleAdapter>>
type TransactionAdapter = Omit<BetterAuthAdapter, 'transaction'>

function createGuardedAdapter(options: BetterAuthOptions, database: AuthDatabase) {
  const base = drizzleAdapter(database, {
    provider: 'pg',
    schema,
    transaction: false,
  })(options)
  return guardSubscriptionPlanWrites(guardOAuthProviderWrites(base, database))
}

function createTransactionAdapter(
  options: BetterAuthOptions,
  tx: DbTransaction
): TransactionAdapter {
  const guarded = createGuardedAdapter(options, tx)
  const { transaction: _transaction, ...surface } = guarded
  return {
    ...surface,
    create: async (input) => {
      if (input.model === 'account' && typeof input.data.providerId === 'string') {
        const [provider] = await tx
          .select({ id: schema.ssoProvider.id })
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.providerId, input.data.providerId))
          .limit(1)
        if (provider) {
          await lockSsoProvider(tx, input.data.providerId)
          const [current] = await tx
            .select({ id: schema.ssoProvider.id })
            .from(schema.ssoProvider)
            .where(
              and(
                eq(schema.ssoProvider.id, provider.id),
                eq(schema.ssoProvider.providerId, input.data.providerId)
              )
            )
            .limit(1)
          if (!current) throw new APIError('NOT_FOUND', { message: 'SSO provider not found' })
        }
      }
      return guarded.create(input)
    },
  }
}

/**
 * Builds every Better Auth adapter surface, including transactional callbacks,
 * with Sim's write invariants applied to the actual Drizzle connection in use.
 */
export function createSimAuthAdapter(
  options: BetterAuthOptions,
  database: AuthDatabase = db
): BetterAuthAdapter {
  const guarded = createGuardedAdapter(options, database)
  const transaction: BetterAuthAdapter['transaction'] = (callback) =>
    database.transaction(async (tx) => {
      const surface = createTransactionAdapter(options, tx)
      return runWithAuthDatabase(tx, () => callback(surface))
    })
  return {
    ...guarded,
    create: (input) =>
      input.model === 'account' ? transaction((tx) => tx.create(input)) : guarded.create(input),
    transaction,
  }
}
