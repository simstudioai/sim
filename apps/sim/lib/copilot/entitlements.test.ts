/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled, mockIsCustomBlocksEligible } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockIsCustomBlocksEligible: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  isCustomBlocksEligible: mockIsCustomBlocksEligible,
}))

import {
  computeWorkspaceEntitlements,
  SUBAGENT_NARRATION_ENTITLEMENT,
} from '@/lib/copilot/entitlements'

describe('computeWorkspaceEntitlements', () => {
  it('includes subagent narration only when its feature flag is enabled', async () => {
    mockIsCustomBlocksEligible.mockResolvedValue(false)
    mockIsFeatureEnabled.mockImplementation(
      async (_flag: string, context: { userId?: string }) => context.userId === 'enabled-user'
    )

    await expect(computeWorkspaceEntitlements('workspace-1', 'disabled-user')).resolves.toEqual([])
    await expect(computeWorkspaceEntitlements('workspace-1', 'enabled-user')).resolves.toEqual([
      SUBAGENT_NARRATION_ENTITLEMENT,
    ])

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('mothership-subagent-narration', {
      userId: 'enabled-user',
    })
  })
})
