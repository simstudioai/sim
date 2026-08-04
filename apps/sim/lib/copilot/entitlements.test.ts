/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  customBlocks: vi.fn(),
  sandboxes: vi.fn(),
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  isCustomBlocksEligible: mocks.customBlocks,
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: mocks.sandboxes,
}))

import {
  CUSTOM_BLOCKS_ENTITLEMENT,
  computeWorkspaceEntitlements,
  SANDBOXES_ENTITLEMENT,
} from '@/lib/copilot/entitlements'

describe('computeWorkspaceEntitlements', () => {
  beforeEach(() => {
    mocks.customBlocks.mockReset().mockResolvedValue(false)
    mocks.sandboxes.mockReset().mockResolvedValue(false)
  })

  it('advertises Sim sandboxes only when the Max/Enterprise predicate passes', async () => {
    mocks.sandboxes.mockResolvedValue(true)

    await expect(computeWorkspaceEntitlements('ws-sandbox-entitled', 'user-1')).resolves.toEqual([
      SANDBOXES_ENTITLEMENT,
    ])
  })

  it('omits failed or unavailable entitlement evaluators', async () => {
    mocks.customBlocks.mockResolvedValue(true)
    mocks.sandboxes.mockRejectedValue(new Error('billing unavailable'))

    await expect(computeWorkspaceEntitlements('ws-sandbox-fail-closed', 'user-1')).resolves.toEqual(
      [CUSTOM_BLOCKS_ENTITLEMENT]
    )
  })
})
