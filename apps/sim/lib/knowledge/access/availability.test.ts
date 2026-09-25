import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  featureEnabled: vi.fn(),
  enterprise: vi.fn(),
  workspaceBilling: vi.fn(),
  workspaceGroups: vi.fn(),
  scopedGroups: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
}))
vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.workspaceBilling,
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true }))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mocks.featureEnabled,
}))
vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: mocks.workspaceGroups,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.scopedGroups,
}))

import {
  forgetKnowledgeAccessAvailability,
  requireOrganizationSearchAvailable,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'

describe('knowledge access availability ownership', () => {
  beforeEach(() => {
    forgetKnowledgeAccessAvailability()
    mocks.featureEnabled.mockResolvedValue(true)
    mocks.enterprise.mockResolvedValue(true)
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
    expect(mocks.enterprise).not.toHaveBeenCalled()
    expect(mocks.scopedGroups).not.toHaveBeenCalled()
  })

  it('rejects ambiguous ownership before selecting a payer', async () => {
    await expect(
      resolveKnowledgeAccessAvailability({ organizationId: 'org-1', workspaceId: 'workspace-1' })
    ).rejects.toThrow('Knowledge access requires one resource owner')
    expect(mocks.workspaceBilling).not.toHaveBeenCalled()
    expect(mocks.enterprise).not.toHaveBeenCalled()
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
