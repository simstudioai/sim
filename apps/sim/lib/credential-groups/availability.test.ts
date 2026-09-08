/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isHosted: true,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { resolveCredentialGroupsAvailability } from '@/lib/credential-groups/availability'

describe('resolveCredentialGroupsAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not expose organization accounts in a personal workspace even with the global flag enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: null,
        ownerBilling: { isEnterprise: true },
      })
    ).resolves.toEqual({ available: false, reason: 'feature_disabled' })
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
  })

  it('attributes a disabled feature flag before considering the plan', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: false },
      })
    ).resolves.toEqual({
      available: false,
      reason: 'feature_disabled',
    })
  })

  it('requires Enterprise when the hosted feature is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: false },
      })
    ).resolves.toEqual({
      available: false,
      reason: 'enterprise_plan_required',
    })
  })

  it('evaluates the flag against the organization id', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await resolveCredentialGroupsAvailability({
      organizationId: 'org-1',
      ownerBilling: { isEnterprise: true },
    })

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('credential-groups', { orgId: 'org-1' })
  })

  it('allows Enterprise organizations when the hosted feature is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await expect(
      resolveCredentialGroupsAvailability({
        organizationId: 'org-1',
        ownerBilling: { isEnterprise: true },
      })
    ).resolves.toEqual({
      available: true,
    })
  })
})
