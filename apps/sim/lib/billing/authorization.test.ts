/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHasPaidSubscription, mockIsOwnerOrAdmin, mockAssertNoUnresolved } = vi.hoisted(() => ({
  mockHasPaidSubscription: vi.fn(),
  mockIsOwnerOrAdmin: vi.fn(),
  mockAssertNoUnresolved: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('@/lib/billing', () => ({ hasPaidSubscription: mockHasPaidSubscription }))
vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOwnerOrAdmin,
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

import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { EnterpriseIssuanceInProgressError } from '@/lib/billing/enterprise-outbox'

describe('authorizeSubscriptionReference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasPaidSubscription.mockResolvedValue(false)
    mockAssertNoUnresolved.mockResolvedValue(undefined)
    mockIsOwnerOrAdmin.mockResolvedValue(true)
  })

  it('blocks an organization checkout while Enterprise issuance is unresolved', async () => {
    mockAssertNoUnresolved.mockRejectedValueOnce(new EnterpriseIssuanceInProgressError())

    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription')
    ).resolves.toBe(false)

    expect(mockAssertNoUnresolved).toHaveBeenCalledWith(expect.anything(), 'org-1')
    expect(mockIsOwnerOrAdmin).not.toHaveBeenCalled()
  })

  it('allows an authorized organization checkout when no paid or reserved entitlement exists', async () => {
    await expect(
      authorizeSubscriptionReference('owner-1', 'org-1', 'upgrade-subscription')
    ).resolves.toBe(true)
    expect(mockIsOwnerOrAdmin).toHaveBeenCalledWith('owner-1', 'org-1')
  })
})
