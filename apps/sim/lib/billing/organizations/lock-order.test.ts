/**
 * @vitest-environment node
 *
 * Lock-order regression guard: the paid-org join billing transaction must lock
 * the personal Pro subscription BEFORE userStats, matching
 * restoreUserProSubscription's subscription → userStats order. Snapshotting
 * userStats before locking the subscription inverts that pair and deadlocks a
 * concurrent Pro restore for the same user.
 */
import { subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reapplyPaidOrgJoinBillingForExistingMember } from '@/lib/billing/organizations/membership'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: vi.fn(),
}))

/**
 * A superset row that satisfies every read in the join path: a paid org sub, a
 * still-active personal Pro to pause, non-zero usage to snapshot, and zero
 * storage (so the conditional org storage-transfer write is skipped — the org
 * lock under test is the canonical pre-lock, not the storage update).
 */
const GENERIC_ROW = {
  id: 'sub-1',
  plan: 'team',
  referenceId: 'user-1',
  status: 'active',
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: 'stripe-1',
  currentPeriodCost: '5',
  proPeriodCostSnapshot: '0',
  storageUsedBytes: 0,
}

type LockOp = { op: 'lock' | 'update' | 'insert'; table: unknown }

function createRecordingTx() {
  const ops: LockOp[] = []
  const select = () => {
    const ctx: { table: unknown } = { table: undefined }
    const chain = {
      from: (table: unknown) => {
        ctx.table = table
        return chain
      },
      where: () => chain,
      for: () => {
        ops.push({ op: 'lock', table: ctx.table })
        return chain
      },
      limit: async () => [GENERIC_ROW],
    }
    return chain
  }
  const tx = {
    select,
    update: (table: unknown) => ({
      set: () => ({
        where: async () => {
          ops.push({ op: 'update', table })
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async () => {
        ops.push({ op: 'insert', table })
      },
    }),
    execute: async () => [],
  }
  return { tx, ops }
}

describe('paid-org join billing lock ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('locks the personal subscription before mutating userStats', async () => {
    const { tx, ops } = createRecordingTx()
    dbChainMockFns.transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    await reapplyPaidOrgJoinBillingForExistingMember('user-1', 'org-1')

    const firstUserStatsUpdate = ops.findIndex((o) => o.op === 'update' && o.table === userStats)
    const subscriptionLock = ops.findIndex((o) => o.op === 'lock' && o.table === subscriptionTable)

    expect(firstUserStatsUpdate).toBeGreaterThanOrEqual(0)
    expect(subscriptionLock).toBeGreaterThanOrEqual(0)
    expect(subscriptionLock).toBeLessThan(firstUserStatsUpdate)
  })
})
