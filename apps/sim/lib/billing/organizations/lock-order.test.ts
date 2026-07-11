/**
 * @vitest-environment node
 *
 * Lock-order regression guard: the paid-org join billing transaction must lock
 * the personal Pro subscription BEFORE userStats, matching
 * restoreUserProSubscription's subscription → userStats order. Snapshotting
 * userStats before locking the subscription inverts that pair and deadlocks a
 * concurrent Pro restore for the same user.
 */
import {
  invitation,
  member,
  outboxEvent,
  subscription as subscriptionTable,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reapplyPaidOrgJoinBillingForExistingMember,
  restoreUserProSubscription,
  transferOrganizationOwnership,
  withInvitationSafeOrganizationAccessMutation,
} from '@/lib/billing/organizations/membership'

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

function createRecordingTx(row = GENERIC_ROW) {
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
      limit: async () => [row],
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

  it('still locks an already-paused personal Pro so a concurrent restore cannot pass it', async () => {
    const { tx, ops } = createRecordingTx({ ...GENERIC_ROW, cancelAtPeriodEnd: true })
    dbChainMockFns.transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    await reapplyPaidOrgJoinBillingForExistingMember('user-1', 'org-1')

    expect(ops.some((op) => op.op === 'lock' && op.table === subscriptionTable)).toBe(true)
  })

  it('does not restore personal Pro when a paid-org membership committed first', async () => {
    const updates: unknown[] = []
    const select = () => {
      const context: { table: unknown } = { table: undefined }
      const chain = {
        from: (table: unknown) => {
          context.table = table
          return chain
        },
        where: () => chain,
        for: () => chain,
        limit: async () =>
          context.table === subscriptionTable
            ? [
                {
                  ...GENERIC_ROW,
                  cancelAtPeriodEnd: true,
                  stripeSubscriptionId: 'stripe-personal',
                },
              ]
            : [],
        then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
          const rows =
            context.table === member
              ? [{ organizationId: 'org-1' }]
              : context.table === subscriptionTable
                ? [{ plan: 'team_6000' }]
                : []
          return Promise.resolve(rows).then(resolve, reject)
        },
      }
      return chain
    }
    const tx = {
      select,
      update: (table: unknown) => ({
        set: () => ({
          where: async () => {
            updates.push(table)
          },
        }),
      }),
      execute: async () => [],
    }
    dbChainMockFns.transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await restoreUserProSubscription('user-1')

    expect(result.restored).toBe(false)
    expect(updates).not.toContain(subscriptionTable)
  })
})

describe('organization ownership transfer reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('cannot change the Stripe customer owner while Enterprise issuance is unresolved', async () => {
    const select = () => {
      const context: { table: unknown } = { table: undefined }
      const chain = {
        from: (table: unknown) => {
          context.table = table
          return chain
        },
        where: () => chain,
        orderBy: () => chain,
        limit: async () =>
          context.table === outboxEvent
            ? [
                {
                  id: 'operation-1',
                  status: 'completed',
                  payload: {
                    version: 1,
                    request: {
                      requestKey: 'enterprise-v2:owner-1:org-1:10000:20000:20000:5',
                      ownerUserId: 'owner-1',
                      organizationId: 'org-1',
                      requestedByEmail: 'admin@sim.ai',
                      requestedByUserId: 'admin-1',
                      invoiceAmountCents: 10000,
                      includedMonthlyCredits: 20000,
                      usageLimitCredits: 20000,
                      seats: 5,
                    },
                    retryRevision: 0,
                    stripeProgress: {},
                  },
                },
              ]
            : [],
      }
      return chain
    }
    const execute = vi.fn().mockResolvedValue([])
    const tx = { select, execute }
    dbChainMockFns.transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await transferOrganizationOwnership({
      organizationId: 'org-1',
      currentOwnerUserId: 'owner-1',
      newOwnerUserId: 'owner-2',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Organization has an unfinished Enterprise issuance')
    const executedSql = execute.mock.calls.map(([query]) => JSON.stringify(query))
    expect(executedSql.some((query) => query.includes('organization-mutation:org-1'))).toBe(true)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

interface RemovalSnapshot {
  email: string
  invitationIds: string[]
  workspaceIds: string[]
}

function mockRemovalSnapshots(snapshots: RemovalSnapshot[]) {
  let index = -1
  let current = snapshots[0]
  dbChainMockFns.select.mockImplementation(() => ({
    from: (table: unknown) => {
      if (table === user) {
        current = snapshots[Math.min(++index, snapshots.length - 1)]
        return {
          where: () => ({ limit: async () => [{ email: current.email }] }),
        }
      }
      if (table === workspace) {
        return {
          where: async () => current.workspaceIds.map((id) => ({ id })),
        }
      }
      if (table === invitation) {
        return {
          where: async () => current.invitationIds.map((id) => ({ id })),
        }
      }
      throw new Error('Unexpected table in removal lock test')
    },
  }))
}

describe.each([
  ['internal', 'all'],
  ['external', 'external'],
] as const)('%s organization-access removal lock ordering', (_label, scope) => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('locks invitation/workspace scope before org and removes access accepted while waiting', async () => {
    mockRemovalSnapshots([
      { email: 'member@example.com', invitationIds: ['invite-1'], workspaceIds: ['workspace-1'] },
      // Acceptance won the invitation lock before removal. The row is no
      // longer pending, but its newly committed permission must still be
      // removed once removal obtains the same lock set.
      { email: 'member@example.com', invitationIds: [], workspaceIds: ['workspace-1'] },
    ])
    let permissionExists = true

    await withInvitationSafeOrganizationAccessMutation(
      { userId: 'user-1', organizationId: 'org-1', scope },
      async () => {
        permissionExists = false
      }
    )

    const executedSql = dbChainMockFns.execute.mock.calls.map(([query]) => JSON.stringify(query))
    const invitationLock = executedSql.findIndex((query) => query.includes('invitation:invite-1'))
    const workspaceLock = executedSql.findIndex((query) =>
      query.includes('workspace-invitations:workspace-1')
    )
    const organizationLock = executedSql.findIndex((query) =>
      query.includes('organization-mutation:org-1')
    )

    expect(invitationLock).toBeGreaterThanOrEqual(0)
    expect(workspaceLock).toBeGreaterThan(invitationLock)
    expect(organizationLock).toBeGreaterThan(workspaceLock)
    expect(permissionExists).toBe(false)
  })
})

describe('organization-access removal lock retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('retries a growing candidate set but stops after five attempts', async () => {
    mockRemovalSnapshots(
      Array.from({ length: 6 }, (_, index) => ({
        email: 'member@example.com',
        invitationIds: Array.from(
          { length: index },
          (_unused, inviteIndex) => `invite-${inviteIndex}`
        ),
        workspaceIds: ['workspace-1'],
      }))
    )
    const operation = vi.fn()

    await expect(
      withInvitationSafeOrganizationAccessMutation(
        { userId: 'user-1', organizationId: 'org-1', scope: 'all' },
        operation
      )
    ).rejects.toThrow('Pending invitations changed repeatedly')

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(5)
    expect(operation).not.toHaveBeenCalled()
  })
})
