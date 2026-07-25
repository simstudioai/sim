import { sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const USER_BILLING_IDENTITY_LOCK_TIMEOUT_MS = 5_000

/**
 * Serializes every mutation that can change whether a user is personally or
 * organization billed. Organization locks alone are insufficient because a
 * personal credit grant does not have an organization id when it begins.
 */
export async function acquireUserBillingIdentityLock(tx: DbOrTx, userId: string): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${USER_BILLING_IDENTITY_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`user-billing-identity:${userId}`}, 0))`
  )
}
