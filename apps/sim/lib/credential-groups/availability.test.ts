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

  it('attributes a disabled feature flag before considering the plan', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    await expect(resolveCredentialGroupsAvailability({ isEnterprise: false })).resolves.toEqual({
      available: false,
      reason: 'feature_disabled',
    })
  })

  it('requires Enterprise when the hosted feature is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await expect(resolveCredentialGroupsAvailability({ isEnterprise: false })).resolves.toEqual({
      available: false,
      reason: 'enterprise_plan_required',
    })
  })

  it('allows Enterprise workspaces when the hosted feature is enabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)

    await expect(resolveCredentialGroupsAvailability({ isEnterprise: true })).resolves.toEqual({
      available: true,
    })
  })
})
