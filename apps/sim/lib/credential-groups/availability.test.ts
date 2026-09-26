import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { resolveCredentialGroupsAvailability } from '@/lib/credential-groups/availability'

const mockIsFeatureEnabled = featureFlagsMockFns.mockIsFeatureEnabled

setEnvFlags({ isHosted: true })
afterAll(resetEnvFlagsMock)

describe('resolveCredentialGroupsAvailability', () => {
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
