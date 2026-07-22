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
  organization,
  outboxEvent,
  permissions,
  subscription as subscriptionTable,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockChangeOrganizationWorkspaceBilledAccountsInTx, mockChangeWorkspaceStoragePayersInTx } =
  vi.hoisted(() => ({
    mockChangeOrganizationWorkspaceBilledAccountsInTx: vi.fn(),
    mockChangeWorkspaceStoragePayersInTx: vi.fn(),
  }))

vi.mock('@/lib/billing/storage/payer-transfer', () => ({
  changeOrganizationWorkspaceBilledAccountsInTx: mockChangeOrganizationWorkspaceBilledAccountsInTx,
  changeWorkspaceStoragePayerInTx: vi.fn(),
  changeWorkspaceStoragePayersInTx: mockChangeWorkspaceStoragePayersInTx,
}))

import {
  reapplyPaidOrgJoinBillingForExistingMember,
  restoreUserProSubscription,
  transferOrganizationOwnership,
  withInvitationSafeOrganizationAccessMutation,
} from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import { attachOwnedWorkspacesToOrganizationTx } from '@/lib/workspaces/organization-workspaces'

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
    mockChangeOrganizationWorkspaceBilledAccountsInTx.mockReset()
    mockChangeWorkspaceStoragePayersInTx.mockReset()
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

describe('workspace payer-change transaction lock ordering', () => {
  it('locks nonzero workspaces before join billing or aggregate payer changes', async () => {
    const ops: Array<{ op: 'lock' | 'payer-transfer' | 'update'; table: unknown }> = []
    let memberSelectCount = 0
    const rowsForTable = (table: unknown): unknown[] => {
      if (table === workspace) {
        return [
          {
            id: 'workspace-1',
            billedAccountUserId: 'user-1',
            organizationId: null,
            storageUsedBytes: 128,
          },
        ]
      }
      if (table === permissions) return [{ userId: 'user-1' }]
      if (table === member) {
        memberSelectCount += 1
        return memberSelectCount === 1 ? [{ userId: 'org-owner' }] : []
      }
      if (table === user) return [{ id: 'user-1' }]
      if (table === organization) return [{ id: 'org-1' }]
      if (table === subscriptionTable) return [GENERIC_ROW]
      if (table === userStats) return [{ currentPeriodCost: '5' }]
      return []
    }
    const select = () => {
      let table: unknown
      const chain = {
        from(source: unknown) {
          table = source
          return chain
        },
        where() {
          return chain
        },
        orderBy() {
          return chain
        },
        for() {
          ops.push({ op: 'lock', table })
          return chain
        },
        limit: async () => rowsForTable(table),
        then(resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(rowsForTable(table)).then(resolve, reject)
        },
      }
      return chain
    }
    const tx = {
      execute: async () => [],
      select,
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => undefined,
          then: (resolve: (value: undefined) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        }),
      }),
      update: (table: unknown) => ({
        set: () => ({
          where: () => {
            ops.push({ op: 'update', table })
            return {
              returning: async () =>
                table === workspace ? [{ id: 'workspace-1' }] : [{ id: 'updated' }],
              then: (resolve: (value: undefined) => unknown, reject: (error: unknown) => unknown) =>
                Promise.resolve(undefined).then(resolve, reject),
            }
          },
        }),
      }),
    }
    mockChangeWorkspaceStoragePayersInTx.mockImplementationOnce(async () => {
      ops.push({ op: 'payer-transfer', table: workspace })
      return []
    })

    await attachOwnedWorkspacesToOrganizationTx(tx as unknown as DbOrTx, {
      ownerUserId: 'user-1',
      organizationId: 'org-1',
      workspaceIds: ['workspace-1'],
    })

    const workspaceLock = ops.findIndex((entry) => entry.op === 'lock' && entry.table === workspace)
    const userStatsUpdate = ops.findIndex(
      (entry) => entry.op === 'update' && entry.table === userStats
    )
    const payerTransfer = ops.findIndex((entry) => entry.op === 'payer-transfer')
    expect(workspaceLock).toBeGreaterThanOrEqual(0)
    expect(userStatsUpdate).toBeGreaterThan(workspaceLock)
    expect(payerTransfer).toBeGreaterThan(userStatsUpdate)
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
                      requestKey: 'enterprise-v3:owner-1:org-1:10000:20000:5',
                      ownerUserId: 'owner-1',
                      organizationId: 'org-1',
                      requestedByEmail: 'admin@sim.ai',
                      requestedByUserId: 'admin-1',
                      invoiceAmountCents: 10000,
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

  it('reassigns billed accounts through one same-payer update and preserves owner semantics', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'member-current', role: 'owner' }])
      .mockResolvedValueOnce([{ id: 'member-new', role: 'admin' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'workspace-billed-b' },
      { id: 'workspace-owner-only' },
    ])
    mockChangeOrganizationWorkspaceBilledAccountsInTx.mockResolvedValueOnce([
      'workspace-billed-a',
      'workspace-billed-b',
    ])

    const result = await transferOrganizationOwnership({
      organizationId: 'org-1',
      currentOwnerUserId: 'owner-1',
      newOwnerUserId: 'owner-2',
    })

    expect(result).toMatchObject({
      success: true,
      billedAccountReassigned: 2,
      workspacesReassigned: 2,
    })
    expect(mockChangeOrganizationWorkspaceBilledAccountsInTx).toHaveBeenCalledTimes(1)
    expect(mockChangeOrganizationWorkspaceBilledAccountsInTx).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        expectedCurrentBilledAccountUserId: 'owner-1',
        billedAccountUserId: 'owner-2',
      }
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({ entityId: 'workspace-billed-a', userId: 'owner-2' }),
      expect.objectContaining({ entityId: 'workspace-billed-b', userId: 'owner-2' }),
      expect.objectContaining({ entityId: 'workspace-owner-only', userId: 'owner-2' }),
    ])
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

describe('cross-organization access mutation lock ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('locks both organizations in deterministic ID order', async () => {
    mockRemovalSnapshots([
      { email: 'member@example.com', invitationIds: [], workspaceIds: [] },
      { email: 'member@example.com', invitationIds: [], workspaceIds: [] },
    ])

    await withInvitationSafeOrganizationAccessMutation(
      {
        userId: 'user-1',
        organizationId: 'org-z',
        additionalOrganizationIds: ['org-a'],
        scope: 'all',
      },
      async () => undefined
    )

    const executedSql = dbChainMockFns.execute.mock.calls.map(([query]) => JSON.stringify(query))
    const firstOrganizationLock = executedSql.findIndex((query) =>
      query.includes('organization-mutation:org-a')
    )
    const secondOrganizationLock = executedSql.findIndex((query) =>
      query.includes('organization-mutation:org-z')
    )
    expect(firstOrganizationLock).toBeGreaterThanOrEqual(0)
    expect(secondOrganizationLock).toBeGreaterThan(firstOrganizationLock)
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
