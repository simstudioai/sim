/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFlagsConfig } from '@/lib/core/config/feature-flags'

const { mockFetch, mockIsPlatformAdmin, envRef, flagRef } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockIsPlatformAdmin: vi.fn(),
  envRef: {
    APPCONFIG_APPLICATION: 'sim-staging' as string | undefined,
    APPCONFIG_ENVIRONMENT: 'staging' as string | undefined,
  },
  flagRef: { isAppConfigEnabled: false },
}))

vi.mock('@/lib/core/config/appconfig', () => ({
  fetchAppConfigProfile: mockFetch,
}))

vi.mock('@/lib/core/config/env', () => ({
  get env() {
    return envRef
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isAppConfigEnabled() {
    return flagRef.isAppConfigEnabled
  },
}))

vi.mock('@/lib/permissions/super-user', () => ({
  isPlatformAdmin: mockIsPlatformAdmin,
}))

import { getFeatureFlags, isFeatureEnabled } from '@/lib/core/config/feature-flags'

/** Make `getFeatureFlags` resolve to `doc` via the AppConfig path (also exercises parseConfig). */
function withAppConfig(doc: unknown) {
  flagRef.isAppConfigEnabled = true
  mockFetch.mockImplementation((_ids, parse) => Promise.resolve(parse(doc)))
}

describe('getFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagRef.isAppConfigEnabled = false
  })

  it('derives flags from fallback secrets (empty registry → empty) when AppConfig is disabled, without fetching', async () => {
    expect(await getFeatureFlags()).toEqual<FeatureFlagsConfig>({ flags: {} })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reads the feature-flags profile and normalizes the payload when enabled', async () => {
    withAppConfig({
      flags: {
        a: { enabled: true },
        b: { orgIds: ['Org_1', ' org_1 ', '', 'org_2'], userIds: 'nope' },
        c: 'not-an-object',
      },
    })

    const { flags } = await getFeatureFlags()
    expect(flags.a).toEqual({ enabled: true })
    expect(flags.b).toEqual({ orgIds: ['Org_1', 'org_1', 'org_2'] })
    expect(flags.c).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith(
      { application: 'sim-staging', environment: 'staging', profile: 'feature-flags' },
      expect.any(Function)
    )
  })

  it('falls back to the secret-derived document when the fetch yields null', async () => {
    flagRef.isAppConfigEnabled = true
    mockFetch.mockResolvedValue(null)
    expect(await getFeatureFlags()).toEqual<FeatureFlagsConfig>({ flags: {} })
  })

  it('degrades gracefully on a malformed document', async () => {
    withAppConfig({ flags: 'not-an-object' })
    expect(await getFeatureFlags()).toEqual<FeatureFlagsConfig>({ flags: {} })
    withAppConfig(null)
    expect(await getFeatureFlags()).toEqual<FeatureFlagsConfig>({ flags: {} })
  })
})

describe('isFeatureEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagRef.isAppConfigEnabled = false
  })

  it('returns false for an unknown flag', async () => {
    withAppConfig({ flags: {} })
    expect(await isFeatureEnabled('missing', { userId: 'u1' })).toBe(false)
  })

  it('matches the global enabled clause', async () => {
    withAppConfig({ flags: { f: { enabled: true } } })
    expect(await isFeatureEnabled('f')).toBe(true)
  })

  it('matches the userId allowlist', async () => {
    withAppConfig({ flags: { f: { userIds: ['u1'] } } })
    expect(await isFeatureEnabled('f', { userId: 'u1' })).toBe(true)
    expect(await isFeatureEnabled('f', { userId: 'u2' })).toBe(false)
    expect(await isFeatureEnabled('f', {})).toBe(false)
  })

  it('matches the orgId allowlist', async () => {
    withAppConfig({ flags: { f: { orgIds: ['o1'] } } })
    expect(await isFeatureEnabled('f', { orgId: 'o1' })).toBe(true)
    expect(await isFeatureEnabled('f', { orgId: 'o2' })).toBe(false)
  })

  describe('admin clause (lazy resolution)', () => {
    it('resolves admin from userId when admins is the deciding clause', async () => {
      withAppConfig({ flags: { f: { admins: true } } })
      mockIsPlatformAdmin.mockResolvedValue(true)
      expect(await isFeatureEnabled('f', { userId: 'u1' })).toBe(true)
      expect(mockIsPlatformAdmin).toHaveBeenCalledWith('u1')

      mockIsPlatformAdmin.mockResolvedValue(false)
      expect(await isFeatureEnabled('f', { userId: 'u2' })).toBe(false)
    })

    it('uses the isAdmin override without querying', async () => {
      withAppConfig({ flags: { f: { admins: true } } })
      expect(await isFeatureEnabled('f', { userId: 'u1', isAdmin: true })).toBe(true)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('resolves to false without querying when userId is absent', async () => {
      withAppConfig({ flags: { f: { admins: true } } })
      expect(await isFeatureEnabled('f', { orgId: 'o1' })).toBe(false)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('does not query when an earlier clause already matched', async () => {
      withAppConfig({ flags: { f: { enabled: true, admins: true } } })
      expect(await isFeatureEnabled('f', { userId: 'u1' })).toBe(true)

      withAppConfig({ flags: { g: { userIds: ['u1'], admins: true } } })
      expect(await isFeatureEnabled('g', { userId: 'u1' })).toBe(true)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('does not query when the rule has no admins clause', async () => {
      withAppConfig({ flags: { f: { userIds: ['u2'] } } })
      expect(await isFeatureEnabled('f', { userId: 'u1' })).toBe(false)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })
  })
})
