/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('@sim/db/schema', () => ({ idempotencyKey: {} }))

import {
  assertEnterpriseReconciliationLeaseHeld,
  type EnterpriseReconciliationLease,
  EnterpriseReconciliationLeaseLostError,
  type EnterpriseReconciliationLeaseStore,
  withEnterpriseReconciliationLease,
} from '@/lib/billing/webhooks/enterprise-reconciliation-lease'
import type { DbOrTx } from '@/lib/db/types'

function inMemoryLeaseStore(): EnterpriseReconciliationLeaseStore {
  let held: EnterpriseReconciliationLease | null = null
  let nextToken = 0

  return {
    async tryAcquire(subscriptionId) {
      if (held) return null
      held = { key: `test:${subscriptionId}`, token: String(++nextToken) }
      return held
    },
    async assertHeld(_tx: DbOrTx, lease) {
      if (held?.token !== lease.token) throw new Error('lease lost')
    },
    async release(lease) {
      if (held?.token === lease.token) held = null
    },
  }
}

describe('Enterprise Stripe reconciliation lease', () => {
  it('serializes current-object reads so an older handler cannot roll back a newer apply', async () => {
    const store = inMemoryLeaseStore()
    let remoteVersion = 1
    let releaseOlderHandler!: () => void
    const olderHandlerPaused = new Promise<void>((resolve) => {
      releaseOlderHandler = resolve
    })
    let signalOlderRead!: () => void
    const olderRead = new Promise<void>((resolve) => {
      signalOlderRead = resolve
    })
    const appliedVersions: number[] = []
    const options = {
      store,
      pollIntervalMs: 0,
      waitTimeoutMs: 1_000,
      wait: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    }

    const older = withEnterpriseReconciliationLease(
      'sub_1',
      async () => {
        const snapshot = remoteVersion
        signalOlderRead()
        await olderHandlerPaused
        appliedVersions.push(snapshot)
      },
      options
    )

    await olderRead
    remoteVersion = 2

    const newer = withEnterpriseReconciliationLease(
      'sub_1',
      async () => {
        const snapshot = remoteVersion
        appliedVersions.push(snapshot)
      },
      options
    )

    // Let the newer delivery contend while the older delivery is paused after
    // its Stripe read. It must not read/apply until the older lease releases.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(appliedVersions).toEqual([])

    releaseOlderHandler()
    await Promise.all([older, newer])

    expect(appliedVersions).toEqual([1, 2])
    expect(appliedVersions.at(-1)).toBe(2)
  })

  it('fences a stale holder after its token has been replaced or expired', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => [] }),
          }),
        }),
      }),
    } as unknown as DbOrTx

    await expect(
      assertEnterpriseReconciliationLeaseHeld(tx, {
        key: 'stripe-enterprise-reconciliation:sub_stale',
        token: 'superseded-token',
      })
    ).rejects.toBeInstanceOf(EnterpriseReconciliationLeaseLostError)
  })
})
