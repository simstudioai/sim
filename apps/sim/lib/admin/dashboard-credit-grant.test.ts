import { member, organization, user, userStats } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  billingIdentityLockMock,
  billingIdentityLockMockFns,
} from '@sim/testing/mocks/billing-identity-lock.mock'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import { billingUsageMock } from '@sim/testing/mocks/billing-usage.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { organizationMemberLimitsMock } from '@sim/testing/mocks/organization-member-limits.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { organizationSeatsMock } from '@sim/testing/mocks/organization-seats.mock'
import { outboxServiceMock } from '@sim/testing/mocks/outbox-service.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoistedMocks = vi.hoisted(() => ({
  billingSubscriptions: [] as unknown[],
  idempotencyCalls: [] as { namespace: string; requestFingerprint: string }[],
  moveWorkspace: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/idempotency/transaction', () => ({
  executeTransactionallyIdempotent: async (
    _tx: unknown,
    params: { namespace: string; requestFingerprint: string; operation: () => Promise<unknown> }
  ) => {
    hoistedMocks.idempotencyCalls.push(params)
    return { result: await params.operation(), isFirstTime: true }
  },
}))
vi.mock('@sim/utils/id', () => idMock)
vi.mock('@/lib/billing/core/plan', () => billingPlanMock)
vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => billingIdentityLockMock)
vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)
vi.mock('@/lib/billing/core/usage', () => billingUsageMock)
vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  ownedAttachableWorkspacesWhere: vi.fn(() => undefined),
}))
vi.mock('@/lib/workspaces/admin-move', () => ({
  moveWorkspaceToOrganization: hoistedMocks.moveWorkspace,
}))
vi.mock('@/lib/billing/enterprise-provisioning', () => ({
  getLatestEnterpriseProvisionings: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/billing/enterprise-outbox', () => ({
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE: 'stripe.sync-enterprise-metadata',
  resolveEnterpriseMetadataIntent: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

import { grantDashboardOrganizationBalance, grantDashboardUserBalance } from '@/lib/admin/dashboard'

const mocks = Object.assign(hoistedMocks, {
  acquireUserLock: billingIdentityLockMockFns.mockAcquireUserBillingIdentityLock,
  recordAudit: auditMockFns.mockRecordAudit,
  acquireLock: organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
  ensureMembership: organizationMembershipMockFns.mockEnsureUserInOrganizationTx,
  transferMembership: organizationMembershipMockFns.mockTransferUserBetweenOrganizations,
})

idMockFns.mockGenerateId.mockReturnValue('generated-id')
billingPlanMockFns.mockGetHighestPrioritySubscription.mockImplementation(
  async () => mocks.billingSubscriptions.shift() ?? null
)
organizationMembershipMockFns.mockGetOrganizationTransferCredentialDependencies.mockResolvedValue(
  []
)

/** The values object passed to the nth `update(...).set(...)` call. */
const updateSetValues = (index = 0): Record<string, unknown> =>
  dbChainMockFns.set.mock.calls[index]?.[0] as Record<string, unknown>

afterAll(resetDbChainMock)

describe('grantDashboardOrganizationBalance', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.billingSubscriptions = []
    mocks.idempotencyCalls = []
  })

  it('SQL-adds the grant to both fields without absorbing it into a custom limit', async () => {
    queueTableRows(organization, [{ id: 'org-1', creditBalance: '0.001', orgUsageLimit: '100' }])
    queueTableRows(member, [{ value: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      { creditBalance: '0.006', orgUsageLimit: '100.005' },
    ])

    const result = await grantDashboardOrganizationBalance(
      'org-1',
      0.005,
      undefined,
      '98ed0a21-856e-4d89-bfe9-f08461f597a3',
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(updateSetValues().creditBalance).toBeDefined()
    expect(updateSetValues().creditBalance).not.toBe('0.005')
    expect(updateSetValues().orgUsageLimit).toBeDefined()
    expect(mocks.idempotencyCalls[0]?.namespace).toBe('admin-credit-grant')
    expect(result).toEqual({ prepaidBalanceDollars: 0.006, usageLimitDollars: 100.005 })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'org-1', action: 'credit.issued' })
    )
  })
})

describe('grantDashboardUserBalance', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.billingSubscriptions = []
    mocks.idempotencyCalls = []
  })

  it('resets a free account to free-plus-prepaid before adding the grant', async () => {
    queueTableRows(user, [{ id: 'user-1' }])
    queueTableRows(userStats, [{ creditBalance: '0.001', currentUsageLimit: '100' }])
    mocks.billingSubscriptions = [null, null]
    dbChainMockFns.returning.mockResolvedValueOnce([
      { creditBalance: '0.006', currentUsageLimit: '5.006' },
    ])

    const result = await grantDashboardUserBalance(
      'user-1',
      0.005,
      ' goodwill ',
      'b59d2ee0-e5af-4e0c-8db1-7584ca1f2c2b',
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(mocks.acquireUserLock).toHaveBeenCalledWith(expect.anything(), 'user-1')
    expect(mocks.idempotencyCalls[0]?.namespace).toBe('admin-credit-grant')
    expect(updateSetValues().creditBalance).toBeDefined()
    expect(updateSetValues().currentUsageLimit).toBeDefined()
    expect(JSON.stringify(updateSetValues().currentUsageLimit)).not.toContain('greatest')
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
    queueTableRows(user, [{ id: 'user-1' }])
    queueTableRows(userStats, [{ creditBalance: '0.001', currentUsageLimit: '100' }])
    mocks.billingSubscriptions = [personalSubscription, personalSubscription]
    dbChainMockFns.returning.mockResolvedValueOnce([
      { creditBalance: '0.006', currentUsageLimit: '100.005' },
    ])

    const result = await grantDashboardUserBalance(
      'user-1',
      0.005,
      undefined,
      '675e9242-a52e-450e-989a-3ad168f79e9b',
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(JSON.stringify(updateSetValues().currentUsageLimit)).toContain('greatest')
    expect(result).toEqual({ prepaidBalanceDollars: 0.006, usageLimitDollars: 100.005 })
  })

  it('rejects any organization member before changing either balance', async () => {
    const organizationSubscription = {
      referenceId: 'org-1',
      status: 'active',
      plan: 'enterprise',
    }
    queueTableRows(user, [{ id: 'user-1' }])
    queueTableRows(member, [{ organizationId: 'org-1' }])
    queueTableRows(userStats, [{ creditBalance: '0', currentUsageLimit: null }])
    queueTableRows(member, [{ organizationId: 'org-1' }])
    mocks.billingSubscriptions = [organizationSubscription]

    await expect(
      grantDashboardUserBalance('user-1', 0.5, undefined, 'fc1da122-d5b8-4d03-97f1-35812207717a', {
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@sim.ai',
      })
    ).rejects.toThrow('grant prepaid balance from Organizations instead')

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
