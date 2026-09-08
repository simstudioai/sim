/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }))

vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))

/** Isolates the real helper from route suites that mock it in the shared worker. */
declare module '@/lib/auth/oauth-provider-feature?oauth-provider-feature-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient declaration for the isolated test import
  export * from '@/lib/auth/oauth-provider-feature'
}

import { isOAuthProviderEnabled } from '@/lib/auth/oauth-provider-feature?oauth-provider-feature-test'

afterAll(resetEnvFlagsMock)

describe('OAuth provider rollout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAuthDisabled: false })
  })

  it('evaluates the global flag again on subsequent requests', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(isOAuthProviderEnabled()).resolves.toBe(false)
    await expect(isOAuthProviderEnabled()).resolves.toBe(true)
    expect(mockIsFeatureEnabled).toHaveBeenNthCalledWith(1, 'oauth-provider')
    expect(mockIsFeatureEnabled).toHaveBeenNthCalledWith(2, 'oauth-provider')
  })

  it('cannot enable OAuth without user authentication', async () => {
    setEnvFlags({ isAuthDisabled: true })
    mockIsFeatureEnabled.mockResolvedValue(true)
    await expect(isOAuthProviderEnabled()).resolves.toBe(false)
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
  })
})
