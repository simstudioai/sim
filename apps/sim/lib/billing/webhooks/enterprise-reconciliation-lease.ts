import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

const LEASE_PREFIX = 'stripe-enterprise-reconciliation'
const LEASE_TTL_MS = 10 * 60 * 1000
const LEASE_WAIT_TIMEOUT_MS = 30 * 1000
const LEASE_POLL_INTERVAL_MS = 100

interface StoredLease {
  kind: 'enterprise-reconciliation-lease'
  token: string
}

export interface EnterpriseReconciliationLease {
  key: string
  token: string
}

export interface EnterpriseReconciliationLeaseStore {
  tryAcquire(subscriptionId: string): Promise<EnterpriseReconciliationLease | null>
  assertHeld(tx: DbOrTx, lease: EnterpriseReconciliationLease): Promise<void>
  release(lease: EnterpriseReconciliationLease): Promise<void>
}

export class EnterpriseReconciliationLeaseLostError extends Error {
  constructor(subscriptionId: string) {
    super(`Enterprise reconciliation lease was lost for ${subscriptionId}`)
    this.name = 'EnterpriseReconciliationLeaseLostError'
  }
}

function leaseKey(subscriptionId: string): string {
  return `${LEASE_PREFIX}:${subscriptionId}`
}

const databaseLeaseStore: EnterpriseReconciliationLeaseStore = {
  async tryAcquire(subscriptionId) {
    const key = leaseKey(subscriptionId)
    const token = generateId()
    const now = new Date()
    const staleBefore = new Date(now.getTime() - LEASE_TTL_MS)
    const storedLease: StoredLease = {
      kind: 'enterprise-reconciliation-lease',
      token,
    }

    const acquired = await db
      .insert(idempotencyKey)
      .values({ key, result: storedLease, createdAt: now })
      .onConflictDoUpdate({
        target: [idempotencyKey.key],
        set: { result: storedLease, createdAt: now },
        // A crashed holder can be reclaimed, but a live holder cannot be
        // displaced while it is between the Stripe read and the fenced write.
        setWhere: lt(idempotencyKey.createdAt, staleBefore),
      })
      .returning({ key: idempotencyKey.key })

    return acquired.length > 0 ? { key, token } : null
  },

  async assertHeld(tx, lease) {
    const freshAfter = new Date(Date.now() - LEASE_TTL_MS)
    const [held] = await tx
      .select({ key: idempotencyKey.key })
      .from(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.key, lease.key),
          sql`${idempotencyKey.result} ->> 'token' = ${lease.token}`,
          gt(idempotencyKey.createdAt, freshAfter)
        )
      )
      .for('update')
      .limit(1)

    if (!held) {
      const subscriptionId = lease.key.slice(`${LEASE_PREFIX}:`.length)
      throw new EnterpriseReconciliationLeaseLostError(subscriptionId)
    }
  },

  async release(lease) {
    await db
      .delete(idempotencyKey)
      .where(
        and(
          eq(idempotencyKey.key, lease.key),
          sql`${idempotencyKey.result} ->> 'token' = ${lease.token}`
        )
      )
  },
}

interface WithLeaseOptions {
  store?: EnterpriseReconciliationLeaseStore
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

/**
 * Serializes the authoritative Stripe read and the fenced local apply for a
 * subscription. This is a durable lease rather than a database lock, so no
 * transaction or pooled connection is held while Stripe is called.
 */
export async function withEnterpriseReconciliationLease<T>(
  subscriptionId: string,
  operation: (lease: EnterpriseReconciliationLease) => Promise<T>,
  options: WithLeaseOptions = {}
): Promise<T> {
  const store = options.store ?? databaseLeaseStore
  const now = options.now ?? Date.now
  const wait =
    options.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const waitTimeoutMs = options.waitTimeoutMs ?? LEASE_WAIT_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? LEASE_POLL_INTERVAL_MS
  const deadline = now() + waitTimeoutMs

  let lease: EnterpriseReconciliationLease | null = null
  while (!lease) {
    lease = await store.tryAcquire(subscriptionId)
    if (lease) break
    if (now() >= deadline) {
      throw new Error(`Timed out waiting to reconcile Enterprise subscription ${subscriptionId}`)
    }
    await wait(pollIntervalMs)
  }

  try {
    return await operation(lease)
  } finally {
    await store.release(lease)
  }
}

export async function assertEnterpriseReconciliationLeaseHeld(
  tx: DbOrTx,
  lease: EnterpriseReconciliationLease
): Promise<void> {
  await databaseLeaseStore.assertHeld(tx, lease)
}
