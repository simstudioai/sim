/**
 * @vitest-environment node
 */
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
  requireOrganizationSearchAvailable,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'

describe('knowledge access availability ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.featureEnabled.mockResolvedValue(true)
    mocks.enterprise.mockResolvedValue(true)
    mocks.scopedGroups.mockResolvedValue(true)
    mocks.workspaceGroups.mockResolvedValue(true)
    mocks.workspaceBilling.mockResolvedValue({ isEnterprise: true, organizationId: 'org-parent' })
  })

  it('evaluates an organization flag and payer without consulting a workspace', async () => {
    await expect(
      resolveKnowledgeAccessAvailability({ organizationId: 'org-1', userId: 'viewer' })
    ).resolves.toEqual({ sourceMirrored: true, memberScoped: true })
    expect(mocks.featureEnabled).toHaveBeenCalledWith('knowledge-member-access', {
      orgId: 'org-1',
    })
    expect(mocks.enterprise).toHaveBeenCalledWith('org-1', 'throw')
    expect(mocks.scopedGroups).toHaveBeenCalledWith({
      kind: 'organization',
      organizationId: 'org-1',
    })
    expect(mocks.workspaceBilling).not.toHaveBeenCalled()
    expect(mocks.workspaceGroups).not.toHaveBeenCalled()
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

  it('preserves workspace billing and workspace feature targeting', async () => {
    await expect(
      resolveKnowledgeAccessAvailability({ workspaceId: 'workspace-1' })
    ).resolves.toEqual({ sourceMirrored: true, memberScoped: true })
    expect(mocks.featureEnabled).toHaveBeenCalledWith('knowledge-member-access', {
      workspaceId: 'workspace-1',
      userId: undefined,
    })
    expect(mocks.workspaceBilling).toHaveBeenCalledWith('workspace-1')
    expect(mocks.workspaceGroups).toHaveBeenCalledWith({
      organizationId: 'org-parent',
      ownerBilling: { isEnterprise: true, organizationId: 'org-parent' },
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

  it('allows Search only for the organization enabled in the rollout', async () => {
    mocks.featureEnabled.mockImplementation(
      async (_flag, context) => context.orgId === 'org-enabled'
    )
    await expect(requireOrganizationSearchAvailable('org-enabled')).resolves.toBeUndefined()
    await expect(requireOrganizationSearchAvailable('org-other')).rejects.toThrow(
      'Search is not enabled'
    )
  })

  it('propagates a feature service failure instead of enabling Search', async () => {
    mocks.featureEnabled.mockRejectedValue(new Error('Feature service unavailable'))
    await expect(requireOrganizationSearchAvailable('org-1')).rejects.toThrow(
      'Feature service unavailable'
    )
  })
})
