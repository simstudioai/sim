import { sql } from 'drizzle-orm'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

const USER_BILLING_IDENTITY_LOCK_TIMEOUT_MS = 5_000

/**
 * Serializes every mutation that can change whether a user is personally or
 * organization billed. Organization locks alone are insufficient because a
 * personal credit grant does not have an organization id when it begins.
 */
export async function acquireUserBillingIdentityLock(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${USER_BILLING_IDENTITY_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await acquireAdvisoryXactLock(tx, 'user_billing_identity', `user-billing-identity:${userId}`)
}
