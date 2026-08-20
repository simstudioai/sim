/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getApiKeyExpiry: vi.fn(),
  isFeatureEnabled: vi.fn(),
  resolveWorkspaceBillingPayer: vi.fn(),
}))

vi.mock('@/lib/api-key/service', () => ({ getApiKeyExpiry: mocks.getApiKeyExpiry }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveWorkspaceBillingPayer: mocks.resolveWorkspaceBillingPayer,
}))

import { readV2ApiCapabilities } from '@/lib/api/application/read-v2-api-capabilities'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const personalKey: Principal = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' }
const workspaceKey: Principal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'key-2',
}

describe('readV2ApiCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getApiKeyExpiry.mockResolvedValue(null)
    mocks.isFeatureEnabled.mockResolvedValue(true)
    mocks.resolveWorkspaceBillingPayer.mockResolvedValue({ billedAccountUserId: 'owner-1' })
  })

  it('resolves a personal key against its own user', async () => {
    mocks.getApiKeyExpiry.mockResolvedValue(new Date('2027-01-01T00:00:00.000Z'))

    const result = await readV2ApiCapabilities.execute({ principal: personalKey, input: {} })

    expect(result).toEqual({
      v2Enabled: true,
      keyType: 'personal',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    })
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('v2-api', { userId: 'user-1' })
    expect(mocks.getApiKeyExpiry).toHaveBeenCalledWith('key-1')
    expect(mocks.resolveWorkspaceBillingPayer).not.toHaveBeenCalled()
  })

  /**
   * The gate keys a workspace key on the workspace's billing owner as
   * rollout-only context. Reporting anything else here would answer a different
   * question than the one every other v2 route is being refused on.
   */
  it('resolves a workspace key against the same billing owner the gate uses', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false)

    const result = await readV2ApiCapabilities.execute({ principal: workspaceKey, input: {} })

    expect(result).toEqual({ v2Enabled: false, keyType: 'workspace', expiresAt: null })
    expect(mocks.resolveWorkspaceBillingPayer).toHaveBeenCalledWith('workspace-1')
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('v2-api', { userId: 'owner-1' })
  })

  it('propagates a missing billing owner as a server fault, never as a false cohort answer', async () => {
    mocks.resolveWorkspaceBillingPayer.mockResolvedValue(null)

    await expect(
      readV2ApiCapabilities.execute({ principal: workspaceKey, input: {} })
    ).rejects.toThrow('Workspace workspace-1 is missing its billing owner')
  })

  it('refuses a principal that is not an API key', async () => {
    const session: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

    await expect(
      readV2ApiCapabilities.execute({ principal: session, input: {} })
    ).rejects.toBeInstanceOf(OrchestrationError)
    expect(mocks.getApiKeyExpiry).not.toHaveBeenCalled()
  })
})
