/**
 * @vitest-environment node
 */
import { resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockHasPaidSubscription,
  mockIsOwnerOrAdmin,
  mockAssertNoUnresolved,
  mockGetOrganizationCoverageForMember,
} = vi.hoisted(() => ({
  mockHasPaidSubscription: vi.fn(),
  mockIsOwnerOrAdmin: vi.fn(),
  mockAssertNoUnresolved: vi.fn(),
  mockGetOrganizationCoverageForMember: vi.fn(),
}))

vi.mock('@/lib/billing', () => ({ hasPaidSubscription: mockHasPaidSubscription }))
vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOwnerOrAdmin,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getOrganizationCoverageForMember: mockGetOrganizationCoverageForMember,
}))
vi.mock('@/lib/billing/subscriptions/utils', () => ({
  isOrgScopedSubscription: ({ referenceId }: { referenceId: string }, userId: string) =>
    referenceId !== userId,
}))
vi.mock('@/lib/billing/enterprise-outbox', () => {
  class EnterpriseIssuanceInProgressError extends Error {}
  return {
    EnterpriseIssuanceInProgressError,
    assertNoUnresolvedEnterpriseIssuance: mockAssertNoUnresolved,
  }
})

import {
  assertPersonalCheckoutAllowed,
  authorizeSubscriptionReference,
  isPersonalCheckoutRequest,
} from '@/lib/billing/authorization'
import { EnterpriseIssuanceInProgressError } from '@/lib/billing/enterprise-outbox'

beforeEach(() => {
  resetDbChainMock()
})

afterAll(() => {
  resetDbChainMock()
})

describe('isPersonalCheckoutRequest', () => {
  it('classifies an explicit self reference as personal regardless of customerType', () => {
    expect(isPersonalCheckoutRequest({ referenceId: 'user-1' }, 'user-1')).toBe(true)
    expect(
      isPersonalCheckoutRequest({ referenceId: 'user-1', customerType: 'organization' }, 'user-1')
    ).toBe(true)
  })

  it('classifies an explicit foreign reference as not personal', () => {
    expect(isPersonalCheckoutRequest({ referenceId: 'org-1' }, 'user-1')).toBe(false)
  })

  it('defaults to personal without a reference unless customerType selects the organization', () => {
    expect(isPersonalCheckoutRequest({}, 'user-1')).toBe(true)
    expect(isPersonalCheckoutRequest({ customerType: 'user' }, 'user-1')).toBe(true)
    expect(isPersonalCheckoutRequest({ customerType: 'organization' }, 'user-1')).toBe(false)
  })
})

describe('authorizeSubscriptionReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasPaidSubscription.mockResolvedValue(false)
    mockAssertNoUnresolved.mockResolvedValue(undefined)
    mockIsOwnerOrAdmin.mockResolvedValue(true)
    mockGetOrganizationCoverageForMember.mockResolvedValue({ status: 'not-covered' })
  })

  it('blocks an organization checkout while Enterprise issuance is unresolved', async () => {
    mockAssertNoUnresolved.mockRejectedValueOnce(new EnterpriseIssuanceInProgressError())

    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription', 'team_6000')
    ).rejects.toThrow(/Enterprise plan setup in progress/)

    expect(mockAssertNoUnresolved).toHaveBeenCalledWith(expect.anything(), 'org-1')
    expect(mockIsOwnerOrAdmin).not.toHaveBeenCalled()
  })

  it('allows an authorized organization checkout when no paid or reserved entitlement exists', async () => {
    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription', 'team_6000')
    ).resolves.toBe(true)
    expect(mockIsOwnerOrAdmin).toHaveBeenCalledWith('owner-1', 'org-1')
  })

  it('rejects an organization checkout for a pro plan — org references only hold Team/Enterprise', async () => {
    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription', 'pro_6000')
    ).rejects.toThrow('Organizations can only subscribe to Team or Enterprise plans.')

    expect(mockHasPaidSubscription).not.toHaveBeenCalled()
    expect(mockIsOwnerOrAdmin).not.toHaveBeenCalled()
  })

  it('rejects an organization checkout when the plan cannot be determined (fail closed)', async () => {
    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription')
    ).rejects.toThrow('Organizations can only subscribe to Team or Enterprise plans.')
  })

  it('blocks an organization checkout when the organization already has an active subscription', async () => {
    mockHasPaidSubscription.mockResolvedValueOnce(true)

    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription', 'team_6000')
    ).rejects.toThrow(/already has an active subscription/)
  })

  it('does not apply checkout-only rules to other billing actions', async () => {
    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'cancel-subscription')
    ).resolves.toBe(true)

    expect(mockHasPaidSubscription).not.toHaveBeenCalled()
    expect(mockIsOwnerOrAdmin).toHaveBeenCalledWith('owner-1', 'org-1')
  })

  it('allows personal references without invoking org checks', async () => {
    await expect(
      authorizeSubscriptionReference('user-1', 'user-1', 'upgrade-subscription', 'pro_6000')
    ).resolves.toBe(true)

    expect(mockGetOrganizationCoverageForMember).not.toHaveBeenCalled()
    expect(mockIsOwnerOrAdmin).not.toHaveBeenCalled()
  })
})

describe('assertPersonalCheckoutAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOrganizationCoverageForMember.mockResolvedValue({ status: 'not-covered' })
  })

  it('allows checkout when the user is not covered by any organization', async () => {
    await expect(assertPersonalCheckoutAllowed('user-1')).resolves.toBeUndefined()
  })

  it('rejects checkout when an organization subscription already covers the user', async () => {
    mockGetOrganizationCoverageForMember.mockResolvedValueOnce({
      status: 'covered',
      organizationId: 'org-1',
    })

    await expect(assertPersonalCheckoutAllowed('user-1')).rejects.toThrow(
      /already covered by your organization/
    )
  })

  it('rejects checkout when coverage cannot be verified (fail closed)', async () => {
    mockGetOrganizationCoverageForMember.mockResolvedValueOnce({ status: 'unknown' })

    await expect(assertPersonalCheckoutAllowed('user-1')).rejects.toThrow(
      /could not verify your billing status/
    )
  })
})
