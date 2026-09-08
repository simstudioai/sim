/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  feature: vi.fn(),
  subscription: vi.fn(),
  blocked: vi.fn(),
  workspace: vi.fn(),
  workspaceAvailable: vi.fn(),
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.feature }))
vi.mock('@/lib/billing/core/subscription', () => ({
  getOrganizationSubscriptionUsable: mocks.subscription,
}))
vi.mock('@/lib/billing/core/access', () => ({ isOrganizationBillingBlocked: mocks.blocked }))
vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.workspace,
}))
vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: mocks.workspaceAvailable,
}))

import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'

describe('owner-scoped connected accounts availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.feature.mockResolvedValue(true)
    mocks.subscription.mockResolvedValue({ plan: 'enterprise', status: 'active' })
    mocks.blocked.mockResolvedValue(false)
  })
  it('uses the exact organization payer and feature context without a workspace', async () => {
    await expect(
      isScopedCredentialGroupsAvailable({ kind: 'organization', organizationId: 'org-1' })
    ).resolves.toBe(true)
    expect(mocks.feature).toHaveBeenCalledWith('credential-groups', { orgId: 'org-1' })
    expect(mocks.subscription).toHaveBeenCalledWith('org-1', { onError: 'throw' })
    expect(mocks.blocked).toHaveBeenCalledWith('org-1')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it.each([{ plan: 'team', status: 'active' }, { plan: 'enterprise', status: 'canceled' }, null])(
    'does not expose an unusable enterprise subscription: %j',
    async (subscription) => {
      mocks.subscription.mockResolvedValue(subscription)
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
    expect(mocks.subscription).not.toHaveBeenCalled()
  })
})
