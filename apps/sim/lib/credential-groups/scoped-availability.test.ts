import { billingAccessMock, billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  billingWorkspaceAccessMock,
  billingWorkspaceAccessMockFns,
} from '@sim/testing/mocks/billing-workspace-access.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  workspaceAvailable: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/core/access', () => billingAccessMock)
vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)
vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: hoisted.workspaceAvailable,
}))

import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'

const mocks = {
  ...hoisted,
  feature: featureFlagsMockFns.mockIsFeatureEnabled,
  blocked: billingAccessMockFns.mockIsOrganizationBillingBlocked,
  workspace: billingWorkspaceAccessMockFns.mockGetWorkspaceOwnerSubscriptionAccess,
}

const mockSubscription = billingSubscriptionMockFns.mockGetOrganizationSubscriptionUsable

setEnvFlags({ isHosted: true })
afterAll(resetEnvFlagsMock)

describe('owner-scoped connected accounts availability', () => {
  beforeEach(() => {
    mocks.feature.mockResolvedValue(true)
    mockSubscription.mockResolvedValue({ plan: 'enterprise', status: 'active' })
    mocks.blocked.mockResolvedValue(false)
  })
  it('uses the exact organization payer and feature context without a workspace', async () => {
    await expect(
      isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId: 'org-1' })
    ).resolves.toBe(true)
    expect(mocks.feature).toHaveBeenCalledWith('credential-groups', { orgId: 'org-1' })
    expect(mockSubscription).toHaveBeenCalledWith('org-1', { onError: 'throw' })
    expect(mocks.blocked).toHaveBeenCalledWith('org-1')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it.each([{ plan: 'team', status: 'active' }, { plan: 'enterprise', status: 'canceled' }, null])(
    'does not expose an unusable enterprise subscription: %j',
    async (subscription) => {
      mockSubscription.mockResolvedValue(subscription)
      await expect(
        isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId: 'org-1' })
      ).resolves.toBe(false)
    }
  )
  it('honors a billing block even when the enterprise subscription is active', async () => {
    mocks.blocked.mockResolvedValue(true)
    await expect(
      isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId: 'org-1' })
    ).resolves.toBe(false)
  })
  it('resolves a workspace to its organization instead of evaluating a workspace rollout', async () => {
    const billing = { isEnterprise: true, organizationId: 'org-parent' }
    mocks.workspace.mockResolvedValue(billing)
    mocks.workspaceAvailable.mockResolvedValue(true)
    await expect(
      isScopedCredentialGroupsAvailable({ kind: 'workspace', workspaceId: 'ws-1' })
    ).resolves.toBe(true)
    expect(mocks.workspaceAvailable).toHaveBeenCalledWith({
      organizationId: 'org-parent',
      ownerBilling: billing,
    })
    expect(mockSubscription).not.toHaveBeenCalled()
  })
})
