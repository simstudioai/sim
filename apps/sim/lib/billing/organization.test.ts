import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
import { billingIdentityLockMock } from '@sim/testing/mocks/billing-identity-lock.mock'
import {
  billingPlanHelpersMock,
  billingPlanHelpersMockFns,
} from '@sim/testing/mocks/billing-plan-helpers.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { billingUsageMock, billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing/mocks/database.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateOrganizationWithOwner,
  mockAttachOwnedWorkspacesToOrganization,
  mockAttachOwnedWorkspacesToOrganizationTx,
  mockAssertNoCompetingEnterpriseIssuance,
} = vi.hoisted(() => ({
  mockCreateOrganizationWithOwner: vi.fn(),
  mockAttachOwnedWorkspacesToOrganization: vi.fn(),
  mockAttachOwnedWorkspacesToOrganizationTx: vi.fn(),
  mockAssertNoCompetingEnterpriseIssuance: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing', () => billingCoreMock)

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/billing/core/usage', () => billingUsageMock)

vi.mock('@/lib/billing/plan-helpers', () => billingPlanHelpersMock)

vi.mock('@/lib/billing/organizations/create-organization', () => ({
  createOrganizationWithOwner: mockCreateOrganizationWithOwner,
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => billingIdentityLockMock)

vi.mock('@/lib/billing/enterprise-outbox', () => ({
  assertNoCompetingEnterpriseIssuance: mockAssertNoCompetingEnterpriseIssuance,
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  attachOwnedWorkspacesToOrganization: mockAttachOwnedWorkspacesToOrganization,
  attachOwnedWorkspacesToOrganizationTx: mockAttachOwnedWorkspacesToOrganizationTx,
}))

import {
  ensureOrganizationForTeamSubscription,
  ensureOrganizationForTeamSubscriptionTx,
  syncSubscriptionUsageLimits,
} from '@/lib/billing/organization'

const { mockGetOrganizationIdForSubscriptionReference } = billingSubscriptionMockFns
const { mockGetPlanPricing, mockIsSubscriptionOrgScoped } = billingCoreMockFns
const { mockSyncUsageLimitsFromSubscription } = billingUsageMockFns
const { mockAcquireOrganizationMutationLock } = organizationMembershipMockFns
billingPlanHelpersMockFns.mockIsPaid.mockImplementation((plan) => plan !== 'free')

function queueWhereResponses(responses: unknown[][]) {
  const queue = [...responses]
  dbChainMockFns.where.mockImplementation(() => {
    const result = queue.shift() ?? []
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>
      for: ReturnType<typeof vi.fn>
    }
    thenable.limit = vi.fn(() => Promise.resolve(result))
    thenable.for = vi.fn(() => Promise.resolve(result))
    return thenable as ReturnType<typeof dbChainMockFns.where>
  })
}

describe('ensureOrganizationForTeamSubscription', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockIsSubscriptionOrgScoped.mockResolvedValue(false)
  })

  it('allows the authoritative Enterprise webhook to apply its own unresolved issuance', async () => {
    mockIsSubscriptionOrgScoped.mockResolvedValueOnce(true)

    const result = await ensureOrganizationForTeamSubscription({
      id: 'sub-enterprise',
      plan: 'enterprise',
      referenceId: 'org-enterprise',
      status: 'active',
      seats: 5,
      enterpriseOperationId: 'operation-1',
    })

    expect(result.referenceId).toBe('org-enterprise')
    expect(mockAssertNoCompetingEnterpriseIssuance).toHaveBeenCalledWith(
      expect.anything(),
      'org-enterprise',
      'operation-1'
    )
  })

  it('transfers a user-referenced team subscription onto the org the user administers', async () => {
    mockIsSubscriptionOrgScoped.mockResolvedValueOnce(false)
    queueWhereResponses([
      // membership lookup: user owns an org
      [{ id: 'member-1', organizationId: 'org-owned', role: 'owner' }],
      // locked membership re-read inside the transfer transaction
      [{ organizationId: 'org-owned', role: 'owner' }],
      // locked subscription re-read inside the transfer transaction
      [{ id: 'sub-1', referenceId: 'user-1', plan: 'team' }],
      // locked organization re-read
      [{ id: 'org-owned' }],
      // duplicate check: org has no entitled subscription
      [],
    ])

    const result = await ensureOrganizationForTeamSubscription({
      id: 'sub-1',
      plan: 'team',
      referenceId: 'user-1',
      status: 'active',
      seats: 2,
    })

    expect(result.referenceId).toBe('org-owned')
    expect(dbChainMockFns.update).toHaveBeenCalled()
    expect(mockAttachOwnedWorkspacesToOrganization).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      organizationId: 'org-owned',
      externalMemberPolicy: 'keep-external',
      includeArchived: true,
    })
    expect(mockCreateOrganizationWithOwner).not.toHaveBeenCalled()
  })

  it('keeps org creation, subscription transfer, and workspace attachment on the caller transaction', async () => {
    queueWhereResponses([[], [], [{ name: 'Owner', email: 'owner@example.com' }]])
    mockAttachOwnedWorkspacesToOrganizationTx.mockRejectedValueOnce(
      new Error('workspace attachment failed')
    )

    await expect(
      ensureOrganizationForTeamSubscriptionTx(dbChainMock.db, {
        id: 'sub-1',
        plan: 'team',
        referenceId: 'owner-1',
        status: 'active',
        seats: 1,
        workspaceIdsToAttach: ['workspace-1'],
      })
    ).rejects.toThrow('workspace attachment failed')

    expect(mockAcquireOrganizationMutationLock).toHaveBeenCalledWith(
      dbChainMock.db,
      expect.stringMatching(/^org_/)
    )
    expect(mockAttachOwnedWorkspacesToOrganizationTx).toHaveBeenCalledWith(
      dbChainMock.db,
      expect.objectContaining({
        ownerUserId: 'owner-1',
        workspaceIds: ['workspace-1'],
      })
    )
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    // The helper never starts a nested/global transaction; the outer
    // acceptance transaction owns rollback of every mutation above.
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})

describe('syncSubscriptionUsageLimits', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetOrganizationIdForSubscriptionReference.mockResolvedValue(null)
  })

  it.each(['team_6000', 'enterprise'])(
    'preserves personal member limits when syncing an organization %s subscription',
    async (plan) => {
      mockGetOrganizationIdForSubscriptionReference.mockResolvedValue('org-1')
      mockGetPlanPricing.mockReturnValue({ basePrice: 25 })
      queueTableRows(schemaMock.member, [{ userId: 'member-1' }, { userId: 'member-2' }])

      await syncSubscriptionUsageLimits({
        id: 'sub-organization',
        plan,
        referenceId: 'org-1',
        status: 'active',
        seats: 2,
      })

      expect(mockSyncUsageLimitsFromSubscription).not.toHaveBeenCalled()
      expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.member)
      expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.userStats)
    }
  )

  it('keeps prepaid headroom additive when a Team seat increase raises the base', async () => {
    mockGetOrganizationIdForSubscriptionReference.mockResolvedValue('org-1')
    mockGetPlanPricing.mockReturnValue({ basePrice: 25 })

    await syncSubscriptionUsageLimits({
      id: 'sub-1',
      plan: 'team_6000',
      referenceId: 'org-1',
      status: 'active',
      seats: 2,
    })

    const update = dbChainMockFns.set.mock.calls[0]?.[0]
    const expression = JSON.stringify(update?.orgUsageLimit)
    expect(expression).toContain('greatest')
    expect(expression).toContain('creditBalance')
    expect(expression).toContain('50')
    expect(expression).not.toContain('0.001')
  })
})
