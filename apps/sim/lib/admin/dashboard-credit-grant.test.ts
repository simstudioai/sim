/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  returningRows: [] as unknown[][],
  billingSubscriptions: [] as unknown[],
  updateSets: [] as Record<string, unknown>[],
  idempotencyCalls: [] as { namespace: string; requestFingerprint: string }[],
  recordAudit: vi.fn(),
  acquireLock: vi.fn(),
  acquireUserLock: vi.fn(),
  ensureMembership: vi.fn(),
  transferMembership: vi.fn(),
  setMemberLimit: vi.fn(),
  reconcileSeats: vi.fn(),
  syncUsageLimits: vi.fn(),
  moveWorkspace: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { CREDIT_ISSUED: 'credit.issued' },
  AuditResourceType: { BILLING: 'billing' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@sim/db', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.for = () => chain
    chain.limit = () => Promise.resolve(mocks.rows.shift() ?? [])
    chain.then = (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(mocks.rows.shift() ?? []).then(resolve)
    return chain
  }
  const update = () => {
    const chain: Record<string, unknown> = {}
    chain.set = (values: Record<string, unknown>) => {
      mocks.updateSets.push(values)
      return chain
    }
    chain.where = () => chain
    chain.returning = () => Promise.resolve(mocks.returningRows.shift() ?? [])
    chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve)
    return chain
  }
  const insert = () => {
    const chain: Record<string, unknown> = {}
    chain.values = () => chain
    chain.onConflictDoNothing = () => Promise.resolve([])
    return chain
  }
  const tx = { select: () => selectChain(), update, insert }
  return {
    db: {
      select: () => selectChain(),
      transaction: async (operation: (executor: typeof tx) => Promise<unknown>) => operation(tx),
    },
  }
})
vi.mock('@/lib/core/idempotency/transaction', () => ({
  executeTransactionallyIdempotent: async (
    _tx: unknown,
    params: { namespace: string; requestFingerprint: string; operation: () => Promise<unknown> }
  ) => {
    mocks.idempotencyCalls.push(params)
    return { result: await params.operation(), isFirstTime: true }
  },
}))
vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: vi.fn(async () => mocks.billingSubscriptions.shift() ?? null),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.acquireLock,
  ensureUserInOrganizationTx: mocks.ensureMembership,
  getOrganizationTransferCredentialDependencies: vi.fn(async () => []),
  removeUserFromOrganization: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
  transferUserBetweenOrganizations: mocks.transferMembership,
}))
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mocks.acquireUserLock,
}))
vi.mock('@/lib/billing/organizations/member-limits', () => ({
  setOrgMemberUsageLimit: mocks.setMemberLimit,
}))
vi.mock('@/lib/billing/organizations/seats', () => ({
  reconcileOrganizationSeats: mocks.reconcileSeats,
}))
vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mocks.syncUsageLimits,
}))
vi.mock('@/lib/workspaces/admin-move', () => ({
  moveWorkspaceToOrganization: mocks.moveWorkspace,
}))
vi.mock('@/lib/billing/enterprise-provisioning', () => ({
  getLatestEnterpriseProvisionings: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/billing/enterprise-outbox', () => ({
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE: 'stripe.sync-enterprise-metadata',
  resolveEnterpriseMetadataIntent: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: vi.fn() }))

import {
  addDashboardOrganizationMember,
  grantDashboardOrganizationBalance,
  grantDashboardUserBalance,
} from '@/lib/admin/dashboard'

describe('grantDashboardOrganizationBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows = []
    mocks.returningRows = []
    mocks.billingSubscriptions = []
    mocks.updateSets = []
    mocks.idempotencyCalls = []
  })

  it('SQL-adds the grant to both fields without absorbing it into a custom limit', async () => {
    mocks.rows = [
      [{ id: 'org-1', creditBalance: '0.001', orgUsageLimit: '100' }],
      [],
      [{ value: 0 }],
    ]
    mocks.returningRows = [[{ creditBalance: '0.006', orgUsageLimit: '100.005' }]]

    const result = await grantDashboardOrganizationBalance(
      'org-1',
      0.005,
      undefined,
      '98ed0a21-856e-4d89-bfe9-f08461f597a3',
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(mocks.updateSets[0].creditBalance).toBeDefined()
    expect(mocks.updateSets[0].creditBalance).not.toBe('0.005')
    expect(mocks.updateSets[0].orgUsageLimit).toBeDefined()
    expect(mocks.updateSets).toHaveLength(1)
    expect(mocks.idempotencyCalls[0]?.namespace).toBe('admin-credit-grant')
    expect(result).toEqual({ prepaidBalanceDollars: 0.006, usageLimitDollars: 100.005 })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'org-1', action: 'credit.issued' })
    )
  })
})

describe('grantDashboardUserBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows = []
    mocks.returningRows = []
    mocks.billingSubscriptions = []
    mocks.updateSets = []
    mocks.idempotencyCalls = []
  })

  it('resets a free account to free-plus-prepaid before adding the grant', async () => {
    mocks.rows = [
      [{ id: 'user-1' }],
      [],
      [{ creditBalance: '0.001', currentUsageLimit: '100' }],
      [],
    ]
    mocks.billingSubscriptions = [null, null]
    mocks.returningRows = [[{ creditBalance: '0.006', currentUsageLimit: '5.006' }]]

    const result = await grantDashboardUserBalance(
      'user-1',
      0.005,
      ' goodwill ',
      'b59d2ee0-e5af-4e0c-8db1-7584ca1f2c2b',
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(mocks.updateSets).toHaveLength(1)
    expect(mocks.acquireUserLock).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(mocks.idempotencyCalls[0]?.namespace).toBe('admin-credit-grant')
    expect(mocks.updateSets[0].creditBalance).toBeDefined()
    expect(mocks.updateSets[0].currentUsageLimit).toBeDefined()
    expect(JSON.stringify(mocks.updateSets[0].currentUsageLimit)).not.toContain('greatest')
    expect(result).toEqual({ prepaidBalanceDollars: 0.006, usageLimitDollars: 5.006 })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'user-1',
        metadata: expect.objectContaining({ amountDollars: 0.005, reason: 'goodwill' }),
      })
    )
  })

  it('adds above a higher custom limit for an entitled personal subscription', async () => {
    const personalSubscription = {
      referenceId: 'user-1',
      status: 'active',
      plan: 'pro',
    }
    mocks.rows = [
      [{ id: 'user-1' }],
      [],
      [{ creditBalance: '0.001', currentUsageLimit: '100' }],
      [],
    ]
    mocks.billingSubscriptions = [personalSubscription, personalSubscription]
    mocks.returningRows = [[{ creditBalance: '0.006', currentUsageLimit: '100.005' }]]

    const result = await grantDashboardUserBalance(
      'user-1',
      0.005,
      undefined,
      '675e9242-a52e-450e-989a-3ad168f79e9b',
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(JSON.stringify(mocks.updateSets[0].currentUsageLimit)).toContain('greatest')
    expect(result).toEqual({ prepaidBalanceDollars: 0.006, usageLimitDollars: 100.005 })
  })

  it('rejects any organization member before changing either balance', async () => {
    const organizationSubscription = {
      referenceId: 'org-1',
      status: 'active',
      plan: 'enterprise',
    }
    mocks.rows = [
      [{ id: 'user-1' }],
      [{ organizationId: 'org-1' }],
      [{ creditBalance: '0', currentUsageLimit: null }],
      [{ organizationId: 'org-1' }],
    ]
    mocks.billingSubscriptions = [organizationSubscription]

    await expect(
      grantDashboardUserBalance('user-1', 0.5, undefined, 'fc1da122-d5b8-4d03-97f1-35812207717a', {
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@sim.ai',
      })
    ).rejects.toThrow('grant prepaid balance from Organizations instead')

    expect(mocks.updateSets).toHaveLength(0)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})

describe('addDashboardOrganizationMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows = []
    mocks.returningRows = []
    mocks.updateSets = []
    mocks.transferMembership.mockReset()
    mocks.moveWorkspace.mockReset()
  })

  it('rejects an existing member inside the transaction before touching their cap', async () => {
    mocks.rows = [[], [{ plan: 'enterprise' }]]
    mocks.ensureMembership.mockResolvedValue({
      success: true,
      memberId: 'member-1',
      alreadyMember: true,
      billingActions: { proUsageSnapshotted: false, proCancelledAtPeriodEnd: false },
    })

    await expect(
      addDashboardOrganizationMember(
        'org-1',
        {
          userId: 'user-1',
          role: 'member',
          usageLimitDollars: null,
          personalWorkspaceIds: [],
        },
        { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
      )
    ).rejects.toThrow('User is already a member')

    expect(mocks.setMemberLimit).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('uses the canonical transfer service and reports each selected personal workspace move', async () => {
    mocks.rows = [
      [{ id: 'workspace-1' }, { id: 'workspace-2' }],
      [{ id: 'member-old', organizationId: 'org-old' }],
    ]
    mocks.transferMembership.mockResolvedValue({
      success: true,
      memberId: 'member-new',
      workspaceAccessRevoked: 2,
      credentialMembershipsRevoked: 1,
      pendingInvitationsCancelled: 0,
      usageCaptured: 3,
    })
    mocks.moveWorkspace
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Workspace changed concurrently'))

    const result = await addDashboardOrganizationMember(
      'org-new',
      {
        userId: 'user-1',
        role: 'admin',
        usageLimitDollars: 25,
        personalWorkspaceIds: ['workspace-1', 'workspace-2'],
      },
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(mocks.transferMembership).toHaveBeenCalledWith({
      userId: 'user-1',
      sourceOrganizationId: 'org-old',
      destinationOrganizationId: 'org-new',
      role: 'admin',
      usageLimitDollars: 25,
      setBy: 'admin-1',
    })
    expect(mocks.moveWorkspace).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      memberId: 'member-new',
      transferredFromOrganizationId: 'org-old',
      workspaceMoves: [
        { workspaceId: 'workspace-1', success: true },
        {
          workspaceId: 'workspace-2',
          success: false,
          error: 'Workspace changed concurrently',
        },
      ],
    })
    expect(mocks.reconcileSeats).toHaveBeenCalledTimes(2)
    expect(mocks.recordAudit).toHaveBeenCalledTimes(2)
  })
})
