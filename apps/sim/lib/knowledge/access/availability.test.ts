import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  billingWorkspaceAccessMock,
  billingWorkspaceAccessMockFns,
} from '@sim/testing/mocks/billing-workspace-access.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ workspaceGroups: vi.fn() }))

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: hoisted.workspaceGroups,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)

import {
  forgetKnowledgeAccessAvailability,
  requireOrganizationSearchAvailable,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'

const mocks = {
  ...hoisted,
  featureEnabled: featureFlagsMockFns.mockIsFeatureEnabled,
  workspaceBilling: billingWorkspaceAccessMockFns.mockGetWorkspaceOwnerSubscriptionAccess,
  scopedGroups: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}

setEnvFlags({ isHosted: true })

describe('knowledge access availability ownership', () => {
  beforeEach(() => {
    forgetKnowledgeAccessAvailability()
    mocks.featureEnabled.mockResolvedValue(true)
    billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mocks.scopedGroups.mockResolvedValue(true)
    mocks.workspaceGroups.mockResolvedValue(true)
    mocks.workspaceBilling.mockResolvedValue({ isEnterprise: true, organizationId: 'org-parent' })
  })

  it('keeps source mirroring independent from managed identity availability', async () => {
    mocks.scopedGroups.mockResolvedValue(false)
    await expect(resolveKnowledgeAccessAvailability({ organizationId: 'org-1' })).resolves.toEqual({
      sourceMirrored: true,
      memberScoped: false,
    })
  })

  it('hides both access modes when the owner-scoped feature is disabled', async () => {
    mocks.featureEnabled.mockResolvedValue(false)
    await expect(resolveKnowledgeAccessAvailability({ organizationId: 'org-1' })).resolves.toEqual({
      sourceMirrored: false,
      memberScoped: false,
    })
    expect(billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
    expect(mocks.scopedGroups).not.toHaveBeenCalled()
  })

  it('rejects ambiguous ownership before selecting a payer', async () => {
    await expect(
      resolveKnowledgeAccessAvailability({ organizationId: 'org-1', workspaceId: 'workspace-1' })
    ).rejects.toThrow('Knowledge access requires one resource owner')
    expect(mocks.workspaceBilling).not.toHaveBeenCalled()
    expect(billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('does not let a user-targeted rollout enable organization retrieval', async () => {
    mocks.featureEnabled.mockImplementation(
      async (_flag, context) => context.userId === 'platform-admin'
    )
    await expect(
      resolveKnowledgeAccessAvailability({
        organizationId: 'org-disabled',
        userId: 'platform-admin',
      })
    ).resolves.toEqual({ sourceMirrored: false, memberScoped: false })
  })

  it.each([
    { knowledge: false, groups: true },
    { knowledge: true, groups: false },
    { knowledge: false, groups: false },
  ])(
    'denies organization Search when either required gate is off: %j',
    async ({ knowledge, groups }) => {
      mocks.featureEnabled.mockResolvedValue(knowledge)
      mocks.scopedGroups.mockResolvedValue(groups)
      await expect(requireOrganizationSearchAvailable('org-1')).rejects.toMatchObject({
        code: 'forbidden',
        message: 'Search is not enabled for this organization',
      })
    }
  )

  it('propagates a feature service failure instead of enabling Search', async () => {
    mocks.featureEnabled.mockRejectedValue(new Error('Feature service unavailable'))
    await expect(requireOrganizationSearchAvailable('org-1')).rejects.toThrow(
      'Feature service unavailable'
    )
  })
})
