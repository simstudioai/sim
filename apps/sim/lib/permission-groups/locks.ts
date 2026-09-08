import { sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const PERMISSION_GROUP_LOCK_TIMEOUT_MS = 5_000

/**
 * Serialize all permission-group membership, scope, and config writes for an
 * organization via a transaction-scoped Postgres advisory lock. Callers acquire
 * it at the top of the transaction that both checks (`findScopeConflicts`) and
 * mutates, so a concurrent member add or scope change can't commit in the
 * check-to-write window and leave a user governed by two groups on the same
 * workspace.
 *
 * The invariant (one effective group per user per workspace) spans users and
 * groups in ways a unique constraint can't express, and these are low-frequency
 * admin writes, so a single org-scoped lock is simpler and more obviously
 * correct than fine-grained per-user/per-group locks with acquire-ordering.
 *
 * Readers take it too, when the value they read decides whether a write in the
 * same transaction may commit. Workspace creation and OAuth refresh re-read
 * the default group's capability under this lock and hold it through their
 * protected writes, closing the check-to-write window.
 *
 * `pg_advisory_xact_lock` auto-releases at transaction end (safe on pooled
 * connections), and `lock_timeout` bounds the wait (raising SQLSTATE 55P03)
 * instead of hanging if a holder is stuck. The key string is the contention
 * identity: any change to its format silently stops contending with in-flight
 * holders.
 *
 * `lockTimeoutAlreadyBounded` skips the `set_config` round trip for a caller
 * that has already bounded `lock_timeout` transaction-locally at the same
 * 5000ms — every advisory lock in `lib/billing/organizations/membership.ts`
 * does, and workspace creation takes those first. It stays a separate statement
 * rather than being folded into the `pg_advisory_xact_lock` select: target-list
 * evaluation order is unspecified, so the bound might not be in force when the
 * lock is requested.
 *
 * LOCK ORDER: this is a LEAF lock. Transactions that hold it acquire no further
 * advisory lock afterwards. Workspace creation and OAuth refresh take it last, after
 * `organization-mutation`, `user-billing-identity`, and the membership lock: a
 * deadlock needs a holder of this lock to wait on one of those, and no such
 * holder exists. Keep it a leaf.
 *
 * Lives in `lib/` rather than beside the routes because `lib/workspaces/policy.ts`
 * acquires it, and `lib/` must not import from `app/api/**`.
 */
export async function acquirePermissionGroupOrgLock(
  tx: DbOrTx,
  organizationId: string,
  options?: { lockTimeoutAlreadyBounded?: boolean }
): Promise<void> {
  if (!options?.lockTimeoutAlreadyBounded) {
    await tx.execute(
      sql`select set_config('lock_timeout', ${`${PERMISSION_GROUP_LOCK_TIMEOUT_MS}ms`}, true)`
    )
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`permission_group:${organizationId}`}, 0))`
  )
}
